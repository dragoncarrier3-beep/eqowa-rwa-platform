import type { PoolClient } from 'pg';

/** Cursor key for the escrow Deposited scan. */
export const ESCROW_DEPOSITS_CURSOR = 'escrow_deposits';

/**
 * Last block a chain scan has fully processed, per scan. Kept apart from the
 * mint store because it is scan state, and the token indexer can reuse it.
 */
export interface SyncStateStore {
  getCursor(key: string): Promise<number | undefined>;
  setCursor(key: string, blockNumber: number): Promise<void>;
}

export class MemorySyncStateStore implements SyncStateStore {
  readonly cursors = new Map<string, number>();

  async getCursor(key: string) {
    return this.cursors.get(key);
  }

  async setCursor(key: string, blockNumber: number) {
    this.cursors.set(key, blockNumber);
  }
}

export class PgSyncStateStore implements SyncStateStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async getCursor(key: string) {
    const result = await this.client.query<{ block_number: string }>(
      `SELECT block_number FROM sync_state WHERE key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row ? Number(row.block_number) : undefined;
  }

  async setCursor(key: string, blockNumber: number) {
    await this.client.query(
      `INSERT INTO sync_state (key, block_number, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET block_number = EXCLUDED.block_number, updated_at = now()`,
      [key, blockNumber],
    );
  }
}
