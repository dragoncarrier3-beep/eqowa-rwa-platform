import { ZeroAddress } from 'ethers';

import type { IndexedTokenEvent } from '../../../../config/tokenEvents.ts';

import { MemoryEventStore } from './memoryStore.ts';
import type { AssetRecord } from './store.ts';

export type HolderBalance = {
  walletAddress: string;
  /** Token base units. */
  balance: bigint;
  frozen: boolean;
  updatedBlock: number;
};

export type LedgerStats = {
  /** Wallets with a positive balance. The on-chain cap counts ONCHAINIDs instead. */
  holderWallets: number;
  frozenWallets: number;
  totalSupply: bigint;
};

/**
 * Token read model: the raw events plus the balances they produce. An event is
 * stored once and moves balances only the first time, so re-scanning a chunk
 * after a crash cannot double count.
 */
export interface TokenLedgerStore {
  ensureAsset(asset: AssetRecord): Promise<void>;
  applyEvent(tokenAddress: string, event: IndexedTokenEvent): Promise<'applied' | 'duplicate'>;
  getBalance(tokenAddress: string, walletAddress: string): Promise<HolderBalance | undefined>;
  /** Wallets holding tokens or frozen, largest balance first. */
  listHolders(tokenAddress: string, options?: { limit?: number }): Promise<HolderBalance[]>;
  stats(tokenAddress: string): Promise<LedgerStats>;
}

/** Balance changes one event causes, as [wallet, delta] pairs. Mint and burn touch one side. */
export function balanceDeltas(event: IndexedTokenEvent): Array<[string, bigint]> {
  if (event.eventName !== 'Transfer') {
    return [];
  }
  const deltas: Array<[string, bigint]> = [];
  if (event.fromAddress.toLowerCase() !== ZeroAddress) {
    deltas.push([event.fromAddress.toLowerCase(), -event.amount]);
  }
  if (event.toAddress.toLowerCase() !== ZeroAddress) {
    deltas.push([event.toAddress.toLowerCase(), event.amount]);
  }
  return deltas;
}

export const DEFAULT_HOLDER_LIMIT = 500;

function byBalanceDesc(a: HolderBalance, b: HolderBalance) {
  if (a.balance === b.balance) {
    return a.walletAddress.localeCompare(b.walletAddress);
  }
  return a.balance > b.balance ? -1 : 1;
}

/** In-memory ledger used by tests and the local simulation. Same contract as Postgres. */
export class MemoryTokenLedger implements TokenLedgerStore {
  readonly events = new MemoryEventStore();
  readonly balances = new Map<string, HolderBalance>();

  private key(tokenAddress: string, walletAddress: string) {
    return `${tokenAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;
  }

  private row(tokenAddress: string, walletAddress: string, block: number) {
    const key = this.key(tokenAddress, walletAddress);
    const existing = this.balances.get(key);
    if (existing) {
      existing.updatedBlock = Math.max(existing.updatedBlock, block);
      return existing;
    }
    const created = { walletAddress: walletAddress.toLowerCase(), balance: 0n, frozen: false, updatedBlock: block };
    this.balances.set(key, created);
    return created;
  }

  async ensureAsset(asset: AssetRecord) {
    await this.events.ensureAsset(asset);
  }

  async applyEvent(tokenAddress: string, event: IndexedTokenEvent) {
    const stored = await this.events.insertTransaction({ ...event, tokenAddress });
    if (stored === 'duplicate') {
      return 'duplicate';
    }
    if (event.eventName === 'AddressFrozen') {
      this.row(tokenAddress, event.fromAddress, event.blockNumber).frozen = event.frozen;
    }
    for (const [wallet, delta] of balanceDeltas(event)) {
      this.row(tokenAddress, wallet, event.blockNumber).balance += delta;
    }
    return 'applied';
  }

  async getBalance(tokenAddress: string, walletAddress: string) {
    const row = this.balances.get(this.key(tokenAddress, walletAddress));
    return row ? { ...row } : undefined;
  }

  private rows(tokenAddress: string) {
    const prefix = `${tokenAddress.toLowerCase()}:`;
    return [...this.balances].filter(([key]) => key.startsWith(prefix)).map(([, row]) => row);
  }

  async listHolders(tokenAddress: string, options: { limit?: number } = {}) {
    return this.rows(tokenAddress)
      .filter((row) => row.balance > 0n || row.frozen)
      .sort(byBalanceDesc)
      .slice(0, options.limit ?? DEFAULT_HOLDER_LIMIT)
      .map((row) => ({ ...row }));
  }

  async stats(tokenAddress: string) {
    const rows = this.rows(tokenAddress);
    return {
      holderWallets: rows.filter((row) => row.balance > 0n).length,
      frozenWallets: rows.filter((row) => row.frozen).length,
      totalSupply: rows.reduce((sum, row) => sum + row.balance, 0n),
    };
  }
}
