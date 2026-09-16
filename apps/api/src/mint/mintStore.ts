import type { MintDeposit, MintQuote, MintQuoteStatus, MintRejectReason } from '../../../../config/mint.ts';

export type MintException = {
  kind: string;
  intentId: string;
  details: Record<string, unknown>;
};

export type StoredMintQuote = MintQuote & {
  rejectReason?: MintRejectReason;
};

export interface MintStore {
  saveQuote(quote: StoredMintQuote): Promise<StoredMintQuote>;
  getQuote(intentId: string): Promise<StoredMintQuote | undefined>;
  saveDeposit(deposit: MintDeposit): Promise<MintDeposit | 'duplicate'>;
  getDeposit(intentId: string): Promise<MintDeposit | undefined>;
  setQuoteStatus(intentId: string, status: MintQuoteStatus, rejectReason?: MintRejectReason): Promise<void>;
  addException(row: MintException): Promise<void>;
  listExceptions(intentId: string): Promise<MintException[]>;
}

export class MemoryMintStore implements MintStore {
  readonly quotes = new Map<string, StoredMintQuote>();
  readonly deposits = new Map<string, MintDeposit>();
  readonly exceptions: MintException[] = [];

  async saveQuote(quote: StoredMintQuote) {
    const copy = { ...quote };
    this.quotes.set(quote.intentId, copy);
    return copy;
  }

  async getQuote(intentId: string) {
    const quote = this.quotes.get(intentId);
    return quote ? { ...quote } : undefined;
  }

  async saveDeposit(deposit: MintDeposit) {
    if (this.deposits.has(deposit.intentId)) {
      return 'duplicate';
    }
    this.deposits.set(deposit.intentId, { ...deposit });
    return { ...deposit };
  }

  async getDeposit(intentId: string) {
    const deposit = this.deposits.get(intentId);
    return deposit ? { ...deposit } : undefined;
  }

  async setQuoteStatus(intentId: string, status: MintQuoteStatus, rejectReason?: MintRejectReason) {
    const quote = this.quotes.get(intentId);
    if (!quote) {
      return;
    }
    quote.status = status;
    if (rejectReason) {
      quote.rejectReason = rejectReason;
    }
  }

  async addException(row: MintException) {
    this.exceptions.push({ ...row, details: { ...row.details } });
  }

  async listExceptions(intentId: string) {
    return this.exceptions
      .filter((row) => row.intentId === intentId)
      .map((row) => ({ ...row, details: { ...row.details } }));
  }
}
