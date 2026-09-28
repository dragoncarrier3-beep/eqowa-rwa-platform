import { getAddress, type Provider } from 'ethers';

import { TOKEN_DECIMALS, TOKEN_NAME, TOKEN_SYMBOL } from '../../../../config/eqowa.ts';
import { CONFIRMATION_BLOCKS } from '../../../../config/mint.ts';
import { TOKEN_INDEX_IFACE, decodeTokenLogs } from '../../../../config/tokenEvents.ts';

import type { SyncStateStore } from '../settlement/syncState.ts';

import type { TokenLedgerStore } from './ledger.ts';

/** Cursor key for the token Transfer and AddressFrozen scan. */
export const TOKEN_TRANSFERS_CURSOR = 'token_transfers';

const TOKEN_TOPICS = [
  TOKEN_INDEX_IFACE.getEvent('Transfer')!.topicHash,
  TOKEN_INDEX_IFACE.getEvent('AddressFrozen')!.topicHash,
];

export type TokenIndexChain = Pick<Provider, 'getBlockNumber' | 'getLogs'>;

type Log = Pick<Console, 'info' | 'warn' | 'error'>;

export type TokenIndexerDeps = {
  chain: TokenIndexChain;
  tokenAddress: string;
  /** First block to scan when no cursor is stored yet: the token deploy block. */
  indexFromBlock: number;
  ledger: TokenLedgerStore;
  syncStore: SyncStateStore;
  pollMs?: number;
  chunkSize?: number;
  confirmationBlocks?: number;
  log?: Log;
};

export type TokenTickResult = {
  head: number;
  scannedTo: number | undefined;
  applied: number;
  duplicates: number;
  errors: number;
};

/**
 * Keeps balances in step with the token. Same shape as the settlement worker:
 * reads only blocks `confirmationBlocks` deep, because the ledger has no undo
 * for a log a reorg drops, and moves the cursor after each whole chunk.
 */
export function createTokenIndexer(deps: TokenIndexerDeps) {
  const log = deps.log ?? console;
  const pollMs = deps.pollMs ?? 15_000;
  const chunkSize = deps.chunkSize ?? 2_000;
  const confirmationBlocks = deps.confirmationBlocks ?? CONFIRMATION_BLOCKS;
  const tokenAddress = getAddress(deps.tokenAddress);

  let running: Promise<TokenTickResult> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;

  async function runTick(): Promise<TokenTickResult> {
    const head = await deps.chain.getBlockNumber();
    const result: TokenTickResult = { head, scannedTo: undefined, applied: 0, duplicates: 0, errors: 0 };

    // The events table joins on the asset row, so it must exist first.
    await deps.ledger.ensureAsset({ tokenAddress, name: TOKEN_NAME, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS });

    const safeHead = head - confirmationBlocks;
    const cursor = await deps.syncStore.getCursor(TOKEN_TRANSFERS_CURSOR);
    let from = cursor === undefined ? deps.indexFromBlock : Math.max(cursor + 1, deps.indexFromBlock);

    try {
      while (from <= safeHead) {
        const to = Math.min(from + chunkSize - 1, safeHead);
        const logs = await deps.chain.getLogs({
          address: tokenAddress,
          topics: [TOKEN_TOPICS],
          fromBlock: from,
          toBlock: to,
        });
        const ordered = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

        // Unlike deposits, a skipped event would leave every later balance
        // wrong, so a failure stops the chunk and the cursor stays put.
        for (const event of decodeTokenLogs(ordered)) {
          const outcome = await deps.ledger.applyEvent(tokenAddress, event);
          if (outcome === 'applied') {
            result.applied += 1;
          } else {
            result.duplicates += 1;
          }
        }

        await deps.syncStore.setCursor(TOKEN_TRANSFERS_CURSOR, to);
        result.scannedTo = to;
        from = to + 1;
      }
    } catch (error) {
      result.errors += 1;
      log.error({ error: String(error), from }, 'token scan failed');
    }

    return result;
  }

  /** One full pass. Concurrent calls share the pass in flight. */
  function tick(): Promise<TokenTickResult> {
    if (!running) {
      running = runTick().finally(() => {
        running = undefined;
      });
    }
    return running;
  }

  function schedule() {
    if (stopped) {
      return;
    }
    timer = setTimeout(async () => {
      try {
        const result = await tick();
        if (result.applied || result.errors) {
          log.info(result, 'token index tick');
        }
      } catch (error) {
        log.error({ error: String(error) }, 'token index tick failed');
      }
      schedule();
    }, pollMs);
  }

  return {
    tick,
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      log.info({ tokenAddress, pollMs, confirmationBlocks }, 'token indexer started');
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      await running?.catch(() => undefined);
    },
  };
}
