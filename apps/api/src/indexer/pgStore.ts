import type { PoolClient } from 'pg';

import type { AssetRecord, EventStore, TransactionRecord } from './store.ts';

export class PgEventStore implements EventStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async ensureAsset(asset: AssetRecord) {
    await this.client.query(
      `INSERT INTO assets (token_address, name, symbol, decimals)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_address) DO NOTHING`,
      [asset.tokenAddress.toLowerCase(), asset.name, asset.symbol, asset.decimals],
    );
  }

  async insertTransaction(row: TransactionRecord) {
    const result = await this.client.query(
      `INSERT INTO transactions (
         asset_id, tx_hash, log_index, block_number, event_name,
         from_address, to_address, amount, frozen
       )
       SELECT id, $2, $3, $4, $5, $6, $7, $8, $9
       FROM assets
       WHERE token_address = $1
       ON CONFLICT (tx_hash, log_index) DO NOTHING`,
      [
        row.tokenAddress.toLowerCase(),
        row.txHash,
        row.logIndex,
        row.blockNumber,
        row.eventName,
        row.fromAddress,
        row.toAddress,
        row.amount === null ? null : row.amount.toString(),
        row.frozen,
      ],
    );

    return (result.rowCount ?? 0) > 0 ? 'inserted' : 'duplicate';
  }

  async listTransactions(tokenAddress: string) {
    const result = await this.client.query<{
      tx_hash: string;
      log_index: number;
      block_number: string;
      event_name: string;
      from_address: string | null;
      to_address: string | null;
      amount: string | null;
      frozen: boolean | null;
    }>(
      `SELECT t.tx_hash, t.log_index, t.block_number, t.event_name,
              t.from_address, t.to_address, t.amount, t.frozen
       FROM transactions t
       JOIN assets a ON a.id = t.asset_id
       WHERE a.token_address = $1
       ORDER BY t.block_number, t.log_index`,
      [tokenAddress.toLowerCase()],
    );

    return result.rows.map((item) => {
      const base = {
        txHash: item.tx_hash,
        logIndex: item.log_index,
        blockNumber: Number(item.block_number),
        fromAddress: item.from_address ?? '',
        tokenAddress: tokenAddress.toLowerCase(),
      };

      if (item.event_name === 'AddressFrozen') {
        return {
          ...base,
          eventName: 'AddressFrozen' as const,
          toAddress: null,
          amount: null,
          frozen: Boolean(item.frozen),
        };
      }

      return {
        ...base,
        eventName: 'Transfer' as const,
        toAddress: item.to_address ?? '',
        amount: BigInt(item.amount ?? '0'),
        frozen: null,
      };
    });
  }
}
