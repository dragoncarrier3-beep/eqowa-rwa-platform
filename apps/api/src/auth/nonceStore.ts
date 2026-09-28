import type { PoolClient } from 'pg';

/** A SIWE nonce is valid this long after it is issued, and only once. */
export const NONCE_TTL_SECONDS = 10 * 60;

export interface NonceStore {
  issue(nonce: string, expiresAt: Date, now: Date): Promise<void>;
  /** True exactly once for an issued, unexpired nonce. */
  consume(nonce: string, now: Date): Promise<boolean>;
}

export class MemoryNonceStore implements NonceStore {
  readonly nonces = new Map<string, Date>();

  async issue(nonce: string, expiresAt: Date, now: Date) {
    for (const [key, expiry] of this.nonces) {
      if (expiry <= now) {
        this.nonces.delete(key);
      }
    }
    this.nonces.set(nonce, expiresAt);
  }

  async consume(nonce: string, now: Date) {
    const expiry = this.nonces.get(nonce);
    this.nonces.delete(nonce);
    return expiry !== undefined && expiry > now;
  }
}

export class PgNonceStore implements NonceStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async issue(nonce: string, expiresAt: Date, now: Date) {
    await this.client.query(`DELETE FROM auth_nonces WHERE expires_at <= $1`, [now]);
    await this.client.query(`INSERT INTO auth_nonces (nonce, expires_at) VALUES ($1, $2)`, [nonce, expiresAt]);
  }

  async consume(nonce: string, now: Date) {
    // DELETE ... RETURNING makes the check and the use one step, so two
    // requests racing with the same signed message cannot both sign in.
    const result = await this.client.query(
      `DELETE FROM auth_nonces WHERE nonce = $1 AND expires_at > $2 RETURNING nonce`,
      [nonce, now],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
