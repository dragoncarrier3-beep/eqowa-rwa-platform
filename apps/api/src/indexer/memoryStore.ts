import type { AssetRecord, EventStore, TransactionRecord } from './store.ts';

/** In-memory store used by tests. Same contract as the Postgres store. */
export class MemoryEventStore implements EventStore {
  readonly assets = new Map<string, AssetRecord>();
  readonly transactions: TransactionRecord[] = [];

  async ensureAsset(asset: AssetRecord) {
    const key = asset.tokenAddress.toLowerCase();
    if (!this.assets.has(key)) {
      this.assets.set(key, { ...asset, tokenAddress: key });
    }
  }

  async insertTransaction(row: TransactionRecord) {
    const exists = this.transactions.some((item) => item.txHash === row.txHash && item.logIndex === row.logIndex);
    if (exists) {
      return 'duplicate';
    }
    this.transactions.push({
      ...row,
      tokenAddress: row.tokenAddress.toLowerCase(),
    });
    return 'inserted';
  }

  async listTransactions(tokenAddress: string) {
    const key = tokenAddress.toLowerCase();
    return this.transactions.filter((item) => item.tokenAddress === key);
  }
}
