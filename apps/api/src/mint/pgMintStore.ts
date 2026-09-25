import type { PoolClient } from 'pg';

import {
  applyExceptionResolution,
  type AuditEntry,
  type ExceptionRecord,
  type ExceptionStatus,
} from '../../../../config/exceptions.ts';
import { ONE_SHARE } from '../../../../config/eqowa.ts';
import type { MintDeposit, MintQuoteStatus, MintRejectReason } from '../../../../config/mint.ts';

import type { MintException, MintStore, StoredMintQuote } from './mintStore.ts';

type QuoteRow = {
  intent_id: string;
  wallet_address: string;
  usdt_amount: string;
  share_amount: string;
  fee_amount: string;
  funds_amount: string;
  remainder_amount: string | null;
  quote_expires_at: Date;
  status: MintQuoteStatus;
  reject_reason: MintRejectReason | null;
  mint_tx_hash: string | null;
};

const QUOTE_COLUMNS = `intent_id, wallet_address, usdt_amount, share_amount, fee_amount,
              funds_amount, remainder_amount, quote_expires_at, status, reject_reason, mint_tx_hash`;

type DepositRow = {
  intent_id: string;
  payer_address: string;
  token_address: string;
  amount: string;
  tx_hash: string | null;
  block_number: string | null;
  created_at: Date;
};

type ExceptionRow = {
  id: string;
  kind: string;
  intent_id: string;
  status: ExceptionStatus;
  details: Record<string, unknown>;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution: string | null;
};

type AuditRow = {
  id: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

function toException(row: ExceptionRow): ExceptionRecord {
  return {
    id: row.id,
    kind: row.kind,
    intentId: row.intent_id,
    status: row.status,
    details: row.details ?? {},
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    resolvedBy: row.resolved_by ?? undefined,
    resolution: row.resolution ?? undefined,
  };
}

function toQuote(row: QuoteRow): StoredMintQuote {
  const shareAmount = BigInt(row.share_amount);
  return {
    intentId: row.intent_id,
    wallet: row.wallet_address,
    usdtAmount: BigInt(row.usdt_amount),
    shares: shareAmount / ONE_SHARE,
    shareAmount,
    fundsAmount: BigInt(row.funds_amount),
    feeAmount: BigInt(row.fee_amount),
    remainderAmount: BigInt(row.remainder_amount ?? '0'),
    quoteExpiresAt: new Date(row.quote_expires_at),
    status: row.status,
    rejectReason: row.reject_reason ?? undefined,
    mintTxHash: row.mint_tx_hash ?? undefined,
  };
}

export class PgMintStore implements MintStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async saveQuote(quote: StoredMintQuote) {
    await this.client.query(
      `INSERT INTO users (wallet_address)
       VALUES ($1)
       ON CONFLICT (wallet_address) DO NOTHING`,
      [quote.wallet.toLowerCase()],
    );

    await this.client.query(
      `INSERT INTO mint_intents (
         intent_id, user_id, wallet_address, usdt_amount, share_amount,
         fee_amount, funds_amount, remainder_amount, quote_expires_at, status
       )
       SELECT $1, id, $2, $3, $4, $5, $6, $7, $8, $9
       FROM users
       WHERE wallet_address = $10`,
      [
        quote.intentId,
        quote.wallet,
        quote.usdtAmount.toString(),
        quote.shareAmount.toString(),
        quote.feeAmount.toString(),
        quote.fundsAmount.toString(),
        quote.remainderAmount.toString(),
        quote.quoteExpiresAt.toISOString(),
        quote.status,
        quote.wallet.toLowerCase(),
      ],
    );

    await this.client.query(
      `INSERT INTO audit_log (actor, action, payload)
       VALUES ('api', 'mint.quoted', $1::jsonb)`,
      [JSON.stringify({ intentId: quote.intentId, wallet: quote.wallet })],
    );

    return quote;
  }

  async getQuote(intentId: string) {
    const result = await this.client.query<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS}
       FROM mint_intents
       WHERE intent_id = $1`,
      [intentId],
    );
    const row = result.rows[0];
    return row ? toQuote(row) : undefined;
  }

  async saveDeposit(deposit: MintDeposit) {
    const result = await this.client.query(
      `INSERT INTO deposits (intent_id, payer_address, token_address, amount, tx_hash, block_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (intent_id) DO NOTHING`,
      [
        deposit.intentId,
        deposit.payerAddress.toLowerCase(),
        deposit.tokenAddress.toLowerCase(),
        deposit.amount.toString(),
        deposit.txHash,
        deposit.blockNumber,
      ],
    );

    if ((result.rowCount ?? 0) === 0) {
      return 'duplicate';
    }

    await this.client.query(
      `INSERT INTO audit_log (actor, action, payload)
       VALUES ('api', 'mint.deposited', $1::jsonb)`,
      [JSON.stringify({ intentId: deposit.intentId, txHash: deposit.txHash })],
    );

    return deposit;
  }

  async getDeposit(intentId: string) {
    const result = await this.client.query<DepositRow>(
      `SELECT intent_id, payer_address, token_address, amount, tx_hash, block_number, created_at
       FROM deposits
       WHERE intent_id = $1`,
      [intentId],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      intentId: row.intent_id,
      payerAddress: row.payer_address,
      tokenAddress: row.token_address,
      amount: BigInt(row.amount),
      txHash: row.tx_hash ?? '',
      blockNumber: Number(row.block_number ?? 0),
      recordedAt: new Date(row.created_at),
    };
  }

  async setQuoteStatus(intentId: string, status: MintQuoteStatus, rejectReason?: MintRejectReason) {
    await this.client.query(
      `UPDATE mint_intents
       SET status = $2, reject_reason = COALESCE($3, reject_reason)
       WHERE intent_id = $1`,
      [intentId, status, rejectReason ?? null],
    );
  }

  async transitionQuoteStatus(intentId: string, from: MintQuoteStatus[], to: MintQuoteStatus) {
    const result = await this.client.query(
      `UPDATE mint_intents
       SET status = $3
       WHERE intent_id = $1 AND status = ANY($2::text[])`,
      [intentId, from, to],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setMintTxHash(intentId: string, txHash: string) {
    await this.client.query(`UPDATE mint_intents SET mint_tx_hash = $2 WHERE intent_id = $1`, [intentId, txHash]);
  }

  async listQuotes(filter: { statuses: MintQuoteStatus[]; limit?: number }) {
    const result = await this.client.query<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS}
       FROM mint_intents
       WHERE status = ANY($1::text[])
       ORDER BY created_at ASC
       LIMIT $2`,
      [filter.statuses, filter.limit ?? 500],
    );
    return result.rows.map(toQuote);
  }

  async addException(row: MintException) {
    const result = await this.client.query<ExceptionRow>(
      `INSERT INTO exceptions (kind, intent_id, details)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, kind, intent_id, status, details, created_at, resolved_at, resolved_by, resolution`,
      [row.kind, row.intentId, JSON.stringify(row.details)],
    );
    const record = toException(result.rows[0]!);
    await this.appendAudit({
      actor: 'api',
      action: 'exception.opened',
      payload: { id: record.id, kind: record.kind, intentId: record.intentId },
    });
    return record;
  }

  async getException(id: string) {
    const result = await this.client.query<ExceptionRow>(
      `SELECT id, kind, intent_id, status, details, created_at, resolved_at, resolved_by, resolution
       FROM exceptions
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toException(row) : undefined;
  }

  async listExceptions(filter: { intentId?: string; status?: ExceptionStatus } = {}) {
    const result = await this.client.query<ExceptionRow>(
      `SELECT id, kind, intent_id, status, details, created_at, resolved_at, resolved_by, resolution
       FROM exceptions
       WHERE ($1::text IS NULL OR intent_id = $1)
         AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at ASC`,
      [filter.intentId ?? null, filter.status ?? null],
    );
    return result.rows.map(toException);
  }

  async resolveException(id: string, params: { actor: string; resolution: string; now: Date }) {
    const current = await this.getException(id);
    if (!current) {
      return 'missing';
    }

    const applied = applyExceptionResolution(current, params);
    if ('error' in applied) {
      return applied.error;
    }

    await this.client.query(
      `UPDATE exceptions
       SET status = $2, resolved_at = $3, resolved_by = $4, resolution = $5
       WHERE id = $1 AND status = 'open'`,
      [
        id,
        applied.record.status,
        applied.record.resolvedAt?.toISOString(),
        applied.record.resolvedBy,
        applied.record.resolution,
      ],
    );

    await this.appendAudit({
      actor: params.actor.trim(),
      action: 'exception.resolved',
      payload: { id, resolution: applied.record.resolution, kind: applied.record.kind },
      now: params.now,
    });
    return applied.record;
  }

  async appendAudit(entry: { actor: string; action: string; payload: Record<string, unknown>; now?: Date }) {
    const result = await this.client.query<AuditRow>(
      `INSERT INTO audit_log (actor, action, payload, created_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, now()))
       RETURNING id::text, actor, action, payload, created_at`,
      [entry.actor, entry.action, JSON.stringify(entry.payload), entry.now?.toISOString() ?? null],
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      actor: row.actor,
      action: row.action,
      payload: row.payload ?? {},
      createdAt: new Date(row.created_at),
    };
  }

  async listAudit(limit: number = 50) {
    const size = limit > 0 ? limit : 50;
    const result = await this.client.query<AuditRow>(
      `SELECT id::text, actor, action, payload, created_at
       FROM audit_log
       ORDER BY id DESC
       LIMIT $1`,
      [size],
    );
    return result.rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      payload: row.payload ?? {},
      createdAt: new Date(row.created_at),
    }));
  }
}
