import type pg from 'pg';

import type { IndexedTokenEvent } from '../../../../config/tokenEvents.ts';

import { DEFAULT_HOLDER_LIMIT, balanceDeltas, type HolderBalance, type TokenLedgerStore } from './ledger.ts';
import { PgEventStore } from './pgStore.ts';
import type { AssetRecord } from './store.ts';

type BalanceRow = { wallet_address: string; balance: string; frozen: boolean; updated_block: string };

function toHolder(row: BalanceRow): HolderBalance {
  return {
    walletAddress: row.wallet_address,
    balance: BigInt(row.balance),
    frozen: row.frozen,
    updatedBlock: Number(row.updated_block),
  };
}

/**
 * Postgres ledger. The event row and the balance changes it causes commit in
 * one transaction, so a crash between them cannot leave a stored event whose
 * balance change was lost.
 */
export class PgTokenLedger implements TokenLedgerStore {
  constructor(private readonly pool: pg.Pool) {}

  async ensureAsset(asset: AssetRecord) {
    await new PgEventStore(this.pool).ensureAsset(asset);
  }

  async applyEvent(tokenAddress: string, event: IndexedTokenEvent) {
    const token = tokenAddress.toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stored = await new PgEventStore(client).insertTransaction({ ...event, tokenAddress: token });
      if (stored === 'duplicate') {
        await client.query('ROLLBACK');
        return 'duplicate';
      }

      if (event.eventName === 'AddressFrozen') {
        await client.query(
          `INSERT INTO balances (token_address, wallet_address, frozen, updated_block)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (token_address, wallet_address) DO UPDATE
             SET frozen = EXCLUDED.frozen,
                 updated_block = GREATEST(balances.updated_block, EXCLUDED.updated_block)`,
          [token, event.fromAddress.toLowerCase(), event.frozen, event.blockNumber],
        );
      }
      for (const [wallet, delta] of balanceDeltas(event)) {
        await client.query(
          `INSERT INTO balances (token_address, wallet_address, balance, updated_block)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (token_address, wallet_address) DO UPDATE
             SET balance = balances.balance + EXCLUDED.balance,
                 updated_block = GREATEST(balances.updated_block, EXCLUDED.updated_block)`,
          [token, wallet, delta.toString(), event.blockNumber],
        );
      }

      await client.query('COMMIT');
      return 'applied';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getBalance(tokenAddress: string, walletAddress: string) {
    const result = await this.pool.query<BalanceRow>(
      `SELECT wallet_address, balance, frozen, updated_block
       FROM balances WHERE token_address = $1 AND wallet_address = $2`,
      [tokenAddress.toLowerCase(), walletAddress.toLowerCase()],
    );
    return result.rows[0] ? toHolder(result.rows[0]) : undefined;
  }

  async listHolders(tokenAddress: string, options: { limit?: number } = {}) {
    const result = await this.pool.query<BalanceRow>(
      `SELECT wallet_address, balance, frozen, updated_block
       FROM balances
       WHERE token_address = $1 AND (balance > 0 OR frozen)
       ORDER BY balance DESC, wallet_address
       LIMIT $2`,
      [tokenAddress.toLowerCase(), options.limit ?? DEFAULT_HOLDER_LIMIT],
    );
    return result.rows.map(toHolder);
  }

  async stats(tokenAddress: string) {
    const result = await this.pool.query<{ holders: string; frozen: string; supply: string }>(
      `SELECT count(*) FILTER (WHERE balance > 0) AS holders,
              count(*) FILTER (WHERE frozen) AS frozen,
              COALESCE(sum(balance), 0) AS supply
       FROM balances WHERE token_address = $1`,
      [tokenAddress.toLowerCase()],
    );
    const row = result.rows[0];
    return {
      holderWallets: Number(row?.holders ?? 0),
      frozenWallets: Number(row?.frozen ?? 0),
      totalSupply: BigInt(row?.supply ?? '0'),
    };
  }
}
