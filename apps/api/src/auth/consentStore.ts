import type { PoolClient } from 'pg';

/** One acceptance: the signed Sign-In with Ethereum message is the evidence. */
export type ConsentRecord = {
  walletAddress: string;
  termsVersion: string;
  message: string;
  signature: string;
  acceptedAt: Date;
};

/** Append-only: an acceptance is never edited or removed, only added. */
export interface ConsentStore {
  record(consent: ConsentRecord): Promise<void>;
  hasAccepted(walletAddress: string, termsVersion: string): Promise<boolean>;
  latest(walletAddress: string): Promise<ConsentRecord | undefined>;
}

export class MemoryConsentStore implements ConsentStore {
  readonly records: ConsentRecord[] = [];

  async record(consent: ConsentRecord) {
    this.records.push({ ...consent, walletAddress: consent.walletAddress.toLowerCase() });
  }

  async hasAccepted(walletAddress: string, termsVersion: string) {
    const key = walletAddress.toLowerCase();
    return this.records.some((item) => item.walletAddress === key && item.termsVersion === termsVersion);
  }

  async latest(walletAddress: string) {
    const key = walletAddress.toLowerCase();
    return this.records.filter((item) => item.walletAddress === key).at(-1);
  }
}

export class PgConsentStore implements ConsentStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async record(consent: ConsentRecord) {
    await this.client.query(
      `INSERT INTO investor_consents (wallet_address, terms_version, message, signature, accepted_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        consent.walletAddress.toLowerCase(),
        consent.termsVersion,
        consent.message,
        consent.signature,
        consent.acceptedAt,
      ],
    );
  }

  async hasAccepted(walletAddress: string, termsVersion: string) {
    const result = await this.client.query(
      `SELECT 1 FROM investor_consents WHERE wallet_address = $1 AND terms_version = $2 LIMIT 1`,
      [walletAddress.toLowerCase(), termsVersion],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async latest(walletAddress: string) {
    const result = await this.client.query<{
      wallet_address: string;
      terms_version: string;
      message: string;
      signature: string;
      accepted_at: Date;
    }>(
      `SELECT wallet_address, terms_version, message, signature, accepted_at
       FROM investor_consents WHERE wallet_address = $1
       ORDER BY accepted_at DESC LIMIT 1`,
      [walletAddress.toLowerCase()],
    );
    const row = result.rows[0];
    return row
      ? {
          walletAddress: row.wallet_address,
          termsVersion: row.terms_version,
          message: row.message,
          signature: row.signature,
          acceptedAt: row.accepted_at,
        }
      : undefined;
  }
}
