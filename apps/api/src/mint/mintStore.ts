import { randomUUID } from 'node:crypto';

import {
  applyExceptionResolution,
  type AuditEntry,
  type ExceptionRecord,
  type ExceptionStatus,
} from '../../../../config/exceptions.ts';
import type { MintDeposit, MintQuote, MintQuoteStatus, MintRejectReason } from '../../../../config/mint.ts';

export type MintException = {
  kind: string;
  intentId: string;
  details: Record<string, unknown>;
};

export type StoredMintQuote = MintQuote & {
  rejectReason?: MintRejectReason;
  /** Hash of the agent mint once broadcast. */
  mintTxHash?: string;
};

export interface MintStore {
  saveQuote(quote: StoredMintQuote): Promise<StoredMintQuote>;
  getQuote(intentId: string): Promise<StoredMintQuote | undefined>;
  saveDeposit(deposit: MintDeposit): Promise<MintDeposit | 'duplicate'>;
  getDeposit(intentId: string): Promise<MintDeposit | undefined>;
  setQuoteStatus(intentId: string, status: MintQuoteStatus, rejectReason?: MintRejectReason): Promise<void>;
  /**
   * Compare-and-set. Moves the intent to `to` only if its current status is in
   * `from`, and reports whether it did. Used to claim an intent for minting.
   */
  transitionQuoteStatus(intentId: string, from: MintQuoteStatus[], to: MintQuoteStatus): Promise<boolean>;
  setMintTxHash(intentId: string, txHash: string): Promise<void>;
  listQuotes(filter: { statuses: MintQuoteStatus[]; limit?: number }): Promise<StoredMintQuote[]>;
  /** One investor's quotes, newest first. */
  listQuotesByWallet(wallet: string, limit?: number): Promise<StoredMintQuote[]>;
  addException(row: MintException): Promise<ExceptionRecord>;
  getException(id: string): Promise<ExceptionRecord | undefined>;
  listExceptions(filter?: { intentId?: string; status?: ExceptionStatus }): Promise<ExceptionRecord[]>;
  resolveException(
    id: string,
    params: { actor: string; resolution: string; now: Date },
  ): Promise<ExceptionRecord | 'missing' | 'already_resolved' | 'empty_resolution' | 'empty_actor'>;
  appendAudit(entry: {
    actor: string;
    action: string;
    payload: Record<string, unknown>;
    now?: Date;
  }): Promise<AuditEntry>;
  listAudit(limit?: number): Promise<AuditEntry[]>;
}

/** In-memory store used by tests and when DATABASE_URL is unset. */
export class MemoryMintStore implements MintStore {
  readonly quotes = new Map<string, StoredMintQuote>();
  readonly deposits = new Map<string, MintDeposit>();
  readonly exceptions: ExceptionRecord[] = [];
  readonly audit: AuditEntry[] = [];

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

  async transitionQuoteStatus(intentId: string, from: MintQuoteStatus[], to: MintQuoteStatus) {
    const quote = this.quotes.get(intentId);
    if (!quote || !from.includes(quote.status)) {
      return false;
    }
    quote.status = to;
    return true;
  }

  async setMintTxHash(intentId: string, txHash: string) {
    const quote = this.quotes.get(intentId);
    if (quote) {
      quote.mintTxHash = txHash;
    }
  }

  async listQuotes(filter: { statuses: MintQuoteStatus[]; limit?: number }) {
    const rows = [...this.quotes.values()].filter((quote) => filter.statuses.includes(quote.status));
    return rows.slice(0, filter.limit ?? rows.length).map((quote) => ({ ...quote }));
  }

  async listQuotesByWallet(wallet: string, limit = 50) {
    const key = wallet.toLowerCase();
    return [...this.quotes.values()]
      .filter((quote) => quote.wallet.toLowerCase() === key)
      .reverse()
      .slice(0, limit)
      .map((quote) => ({ ...quote }));
  }

  async addException(row: MintException) {
    const record: ExceptionRecord = {
      id: randomUUID(),
      kind: row.kind,
      intentId: row.intentId,
      status: 'open',
      details: { ...row.details },
      createdAt: new Date(),
    };
    this.exceptions.push(record);
    await this.appendAudit({
      actor: 'api',
      action: 'exception.opened',
      payload: { id: record.id, kind: record.kind, intentId: record.intentId },
    });
    return { ...record, details: { ...record.details } };
  }

  async getException(id: string) {
    const row = this.exceptions.find((item) => item.id === id);
    return row ? { ...row, details: { ...row.details } } : undefined;
  }

  async listExceptions(filter: { intentId?: string; status?: ExceptionStatus } = {}) {
    return this.exceptions
      .filter((item) => (filter.intentId ? item.intentId === filter.intentId : true))
      .filter((item) => (filter.status ? item.status === filter.status : true))
      .map((item) => ({ ...item, details: { ...item.details } }));
  }

  async resolveException(id: string, params: { actor: string; resolution: string; now: Date }) {
    const index = this.exceptions.findIndex((item) => item.id === id);
    if (index === -1) {
      return 'missing';
    }

    const applied = applyExceptionResolution(this.exceptions[index]!, params);
    if ('error' in applied) {
      return applied.error;
    }

    this.exceptions[index] = applied.record;
    await this.appendAudit({
      actor: params.actor.trim(),
      action: 'exception.resolved',
      payload: { id, resolution: applied.record.resolution, kind: applied.record.kind },
      now: params.now,
    });
    return { ...applied.record, details: { ...applied.record.details } };
  }

  async appendAudit(entry: { actor: string; action: string; payload: Record<string, unknown>; now?: Date }) {
    const row: AuditEntry = {
      id: randomUUID(),
      actor: entry.actor,
      action: entry.action,
      payload: { ...entry.payload },
      createdAt: entry.now ?? new Date(),
    };
    this.audit.push(row);
    return { ...row, payload: { ...row.payload } };
  }

  async listAudit(limit: number = 50) {
    const size = limit > 0 ? limit : 50;
    return this.audit
      .slice(-size)
      .reverse()
      .map((row) => ({ ...row, payload: { ...row.payload } }));
  }
}
