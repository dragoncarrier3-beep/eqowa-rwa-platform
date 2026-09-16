import type { PoolClient } from 'pg';

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
};

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
  kind: string;
  intent_id: string;
  details: Record<string, unknown>;
};

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
      `SELECT intent_id, wallet_address, usdt_amount, share_amount, fee_amount,
              funds_amount, remainder_amount, quote_expires_at, status, reject_reason
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

  async addException(row: MintException) {
    await this.client.query(
      `INSERT INTO exceptions (kind, intent_id, details)
       VALUES ($1, $2, $3::jsonb)`,
      [row.kind, row.intentId, JSON.stringify(row.details)],
    );
  }

  async listExceptions(intentId: string) {
    const result = await this.client.query<ExceptionRow>(
      `SELECT kind, intent_id, details
       FROM exceptions
       WHERE intent_id = $1`,
      [intentId],
    );
    return result.rows.map((row) => ({
      kind: row.kind,
      intentId: row.intent_id,
      details: row.details,
    }));
  }
}
