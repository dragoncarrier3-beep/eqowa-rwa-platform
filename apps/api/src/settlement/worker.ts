import { getAddress, type Provider } from 'ethers';

import {
  DEPOSITED_TOPIC,
  decodeEscrowDepositLogs,
  type EscrowDepositedEvent,
} from '../../../../config/escrowEvents.ts';
import { CONFIRMATION_BLOCKS } from '../../../../config/mint.ts';

import type { IdentityStore } from '../kyc/identityStore.ts';
import type { MintStore } from '../mint/mintStore.ts';
import {
  confirmMintQuote,
  recordMintDeposit,
  settleMintQuote,
  type MintExecutor,
  type MintReceiptStatus,
} from '../mint/pipeline.ts';

import { ESCROW_DEPOSITS_CURSOR, type SyncStateStore } from './syncState.ts';

export type SettlementChain = Pick<Provider, 'getBlockNumber' | 'getLogs' | 'getBlock' | 'getTransactionReceipt'>;

type Log = Pick<Console, 'info' | 'warn' | 'error'>;

export type SettlementWorkerDeps = {
  chain: SettlementChain;
  escrowAddress: string;
  usdtAddress: string;
  /** First block to scan when no cursor is stored yet: the escrow deploy block. */
  indexFromBlock: number;
  mintStore: MintStore;
  identities: IdentityStore;
  syncStore: SyncStateStore;
  mint: MintExecutor;
  now?: () => Date;
  pollMs?: number;
  chunkSize?: number;
  confirmationBlocks?: number;
  log?: Log;
};

export type TickResult = {
  head: number;
  scannedTo: number | undefined;
  depositsRecorded: number;
  exceptionsOpened: number;
  mintsSent: number;
  mintsConfirmed: number;
  errors: number;
};

/**
 * Watches the escrow for Deposited logs and settles the matching intents.
 *
 * Deposits are only read once they are `confirmationBlocks` deep. The deposits
 * table has no delete path, so recording a log that a reorg later drops would
 * leave a phantom payment that mints. Reading at head minus 12 makes the row as
 * final as the pipeline's own 12-block rule.
 *
 * Each deposit is recorded with its block timestamp, not the wall clock, so a
 * worker catching up after downtime does not reject valid deposits as late.
 */
export function createSettlementWorker(deps: SettlementWorkerDeps) {
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  const pollMs = deps.pollMs ?? 15_000;
  const chunkSize = deps.chunkSize ?? 2_000;
  const confirmationBlocks = deps.confirmationBlocks ?? CONFIRMATION_BLOCKS;
  const escrowAddress = getAddress(deps.escrowAddress);
  const usdtAddress = getAddress(deps.usdtAddress);

  // The worker never blocks a tick waiting for a mint to be mined. It sends,
  // looks the receipt up once, and confirms on a later tick if still pending.
  const receiptStatus = async (txHash: string): Promise<MintReceiptStatus> => {
    const receipt = await deps.chain.getTransactionReceipt(txHash);
    if (!receipt) {
      return 'pending';
    }
    return receipt.status === 1 ? 'success' : 'reverted';
  };
  const nonBlockingMint: MintExecutor = { send: deps.mint.send, wait: receiptStatus };

  let running: Promise<TickResult> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;

  async function openOnce(kind: string, intentId: string, details: Record<string, unknown>) {
    // Any status, not only open: a resolved stray deposit must not reopen on a re-scan.
    const existing = await deps.mintStore.listExceptions({ intentId });
    if (existing.some((row) => row.kind === kind)) {
      return false;
    }
    await deps.mintStore.addException({ kind, intentId, details });
    return true;
  }

  async function handleDeposit(
    event: EscrowDepositedEvent,
    blockTime: (blockNumber: number) => Promise<Date>,
    result: TickResult,
  ) {
    const where = { txHash: event.txHash, blockNumber: event.blockNumber, payer: event.payer };

    // Escrow only ever emits its own USDT, so this fires on a misconfigured
    // USDT_ADDRESS. Refuse to mint against a token we did not price.
    if (event.token !== usdtAddress) {
      if (await openOnce('wrong_token', event.intentId, { ...where, token: event.token, expected: usdtAddress })) {
        result.exceptionsOpened += 1;
      }
      return;
    }

    const quote = await deps.mintStore.getQuote(event.intentId);
    if (!quote) {
      if (await openOnce('unknown_intent', event.intentId, { ...where, amount: event.amount.toString() })) {
        result.exceptionsOpened += 1;
      }
      return;
    }

    const recorded = await recordMintDeposit({
      input: {
        intentId: event.intentId,
        payerAddress: event.payer,
        tokenAddress: event.token,
        amount: event.amount.toString(),
        txHash: event.txHash,
        blockNumber: event.blockNumber,
      },
      store: deps.mintStore,
      now: await blockTime(event.blockNumber),
    });
    if ('deposit' in recorded && !recorded.duplicate) {
      result.depositsRecorded += 1;
    }
  }

  async function scan(safeHead: number, result: TickResult) {
    const cursor = await deps.syncStore.getCursor(ESCROW_DEPOSITS_CURSOR);
    let from = cursor === undefined ? deps.indexFromBlock : Math.max(cursor + 1, deps.indexFromBlock);

    const blockTimes = new Map<number, Date>();
    const blockTime = async (blockNumber: number) => {
      const cached = blockTimes.get(blockNumber);
      if (cached) {
        return cached;
      }
      const block = await deps.chain.getBlock(blockNumber);
      if (!block) {
        throw new Error(`block ${blockNumber} not found`);
      }
      const time = new Date(block.timestamp * 1000);
      blockTimes.set(blockNumber, time);
      return time;
    };

    while (from <= safeHead) {
      const to = Math.min(from + chunkSize - 1, safeHead);
      const logs = await deps.chain.getLogs({
        address: escrowAddress,
        topics: [DEPOSITED_TOPIC],
        fromBlock: from,
        toBlock: to,
      });

      for (const event of decodeEscrowDepositLogs(logs)) {
        try {
          await handleDeposit(event, blockTime, result);
        } catch (error) {
          result.errors += 1;
          log.error({ intentId: event.intentId, txHash: event.txHash, error: String(error) }, 'deposit failed');
        }
      }

      // Only after the whole chunk is handled. A crash re-scans the chunk, and
      // duplicate deposits and once-only exceptions make that harmless.
      await deps.syncStore.setCursor(ESCROW_DEPOSITS_CURSOR, to);
      result.scannedTo = to;
      from = to + 1;
    }
  }

  async function sweep(head: number, result: TickResult) {
    for (const quote of await deps.mintStore.listQuotes({ statuses: ['minting'] })) {
      try {
        const confirmed = await confirmMintQuote({
          intentId: quote.intentId,
          store: deps.mintStore,
          waitFor: receiptStatus,
        });
        if ('decision' in confirmed && !confirmed.decision.alreadyMinted) {
          result.mintsConfirmed += 1;
        }
      } catch (error) {
        result.errors += 1;
        log.error({ intentId: quote.intentId, error: String(error) }, 'mint confirm failed');
      }
    }

    for (const quote of await deps.mintStore.listQuotes({ statuses: ['deposited', 'awaiting_confirmations'] })) {
      try {
        const before = quote.status;
        const settled = await settleMintQuote({
          intentId: quote.intentId,
          store: deps.mintStore,
          identities: deps.identities,
          now: now(),
          currentBlock: head,
          mint: nonBlockingMint,
        });
        const after = (await deps.mintStore.getQuote(quote.intentId))?.status;
        if (after === 'minting' || after === 'minted') {
          result.mintsSent += 1;
        }
        if (after === 'minted') {
          result.mintsConfirmed += 1;
        }
        if ('error' in settled && settled.error === 'mint_failed') {
          log.warn({ intentId: quote.intentId, from: before, reason: settled.reason }, 'mint failed, paused for ops');
        }
      } catch (error) {
        result.errors += 1;
        log.error({ intentId: quote.intentId, error: String(error) }, 'settle failed');
      }
    }
  }

  async function runTick(): Promise<TickResult> {
    const head = await deps.chain.getBlockNumber();
    const result: TickResult = {
      head,
      scannedTo: undefined,
      depositsRecorded: 0,
      exceptionsOpened: 0,
      mintsSent: 0,
      mintsConfirmed: 0,
      errors: 0,
    };

    const safeHead = head - confirmationBlocks;
    try {
      await scan(safeHead, result);
    } catch (error) {
      // An RPC failure leaves the cursor where it was. Settling what is
      // already recorded is still safe, so the sweep runs regardless.
      result.errors += 1;
      log.error({ error: String(error) }, 'escrow scan failed');
    }

    await sweep(head, result);
    return result;
  }

  /** One full pass. Concurrent calls share the pass in flight. */
  function tick(): Promise<TickResult> {
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
        if (result.depositsRecorded || result.exceptionsOpened || result.mintsSent || result.errors) {
          log.info(result, 'settlement tick');
        }
      } catch (error) {
        log.error({ error: String(error) }, 'settlement tick failed');
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
      log.info({ escrowAddress, pollMs, confirmationBlocks }, 'settlement worker started');
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
