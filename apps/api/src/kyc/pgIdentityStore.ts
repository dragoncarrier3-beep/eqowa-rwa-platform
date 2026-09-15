import type { PoolClient } from 'pg';

import type { IdentityRecord, IdentityStore } from './identityStore.ts';

type IdentityRow = {
  wallet_address: string;
  onchainid_address: string;
  country_code: number | null;
  kyc_status: IdentityRecord['kycStatus'];
  sumsub_applicant_id: string;
};

function toRecord(row: IdentityRow, claims: number[]): IdentityRecord {
  return {
    walletAddress: row.wallet_address,
    onchainIdAddress: row.onchainid_address,
    countryCode: row.country_code,
    kycStatus: row.kyc_status,
    applicantId: row.sumsub_applicant_id,
    claims,
  };
}

export class PgIdentityStore implements IdentityStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async recordKyc(record: IdentityRecord) {
    await this.client.query(
      `INSERT INTO users (wallet_address)
       VALUES ($1)
       ON CONFLICT (wallet_address) DO NOTHING`,
      [record.walletAddress.toLowerCase()],
    );

    await this.client.query(
      `INSERT INTO identities (
         user_id, onchainid_address, country_code, kyc_status, sumsub_applicant_id
       )
       SELECT id, $2, $3, $4, $5
       FROM users
       WHERE wallet_address = $1
       ON CONFLICT (onchainid_address) DO UPDATE SET
         country_code = EXCLUDED.country_code,
         kyc_status = EXCLUDED.kyc_status,
         sumsub_applicant_id = EXCLUDED.sumsub_applicant_id`,
      [
        record.walletAddress.toLowerCase(),
        record.onchainIdAddress.toLowerCase(),
        record.countryCode,
        record.kycStatus,
        record.applicantId,
      ],
    );

    await this.client.query(
      `INSERT INTO kyc_events (applicant_id, event_type, review_answer, country_code, status, payload)
       VALUES ($1, 'applicantReviewed', $2, $3, $4, $5::jsonb)`,
      [
        record.applicantId,
        record.kycStatus === 'approved' ? 'GREEN' : 'RED',
        record.countryCode,
        record.kycStatus,
        JSON.stringify({ claims: record.claims, wallet: record.walletAddress }),
      ],
    );

    await this.client.query(
      `INSERT INTO audit_log (actor, action, payload)
       VALUES ('sumsub', 'kyc.reviewed', $1::jsonb)`,
      [JSON.stringify({ applicantId: record.applicantId, status: record.kycStatus })],
    );

    return record;
  }

  async getByApplicant(applicantId: string) {
    const result = await this.client.query<IdentityRow>(
      `SELECT u.wallet_address, i.onchainid_address, i.country_code, i.kyc_status, i.sumsub_applicant_id
       FROM identities i
       JOIN users u ON u.id = i.user_id
       WHERE i.sumsub_applicant_id = $1`,
      [applicantId],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return toRecord(row, row.kyc_status === 'approved' ? [1, 2] : []);
  }

  async getByWallet(wallet: string) {
    const result = await this.client.query<IdentityRow>(
      `SELECT u.wallet_address, i.onchainid_address, i.country_code, i.kyc_status, i.sumsub_applicant_id
       FROM identities i
       JOIN users u ON u.id = i.user_id
       WHERE u.wallet_address = $1`,
      [wallet.toLowerCase()],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return toRecord(row, row.kyc_status === 'approved' ? [1, 2] : []);
  }
}
