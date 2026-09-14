import type { IndexedTokenEvent } from '../../../../config/tokenEvents.ts';

export type AssetRecord = {
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type TransactionRecord = IndexedTokenEvent & {
  tokenAddress: string;
};

export interface EventStore {
  ensureAsset(asset: AssetRecord): Promise<void>;
  insertTransaction(row: TransactionRecord): Promise<'inserted' | 'duplicate'>;
  listTransactions(tokenAddress: string): Promise<TransactionRecord[]>;
}
