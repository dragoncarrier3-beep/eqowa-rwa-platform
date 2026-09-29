import type { PoolClient } from 'pg';

import type {
  IdentityFilter,
  IdentityRecord,
  IdentityStore,
  KycEvent,
  OnchainRegistration,
  OnchainStatus,
} from './identityStore.ts';

type IdentityRow = {
  wallet_address: string;
  onchainid_address: string;
  country_code: number | null;
  kyc_status: IdentityRecord['kycStatus'];
  sumsub_applicant_id: string;
  onchain_identity: string | null;
  onchain_status: OnchainStatus;
  onchain_error: string | null;
  onchain_attempts: number;
};

type EventRow = {
  applicant_id: string;
  event_type: string;
  review_answer: string | null;
  country_code: number | null;
  status: KycEvent['status'];
  payload: { reason?: string | null; webhook?: Record<string, unknown> } | null;
  created_at: Date;
};

const IDENTITY_SELECT = `SELECT u.wallet_address, i.onchainid_address, i.country_code, i.kyc_status, i.sumsub_applicant_id,
              i.onchain_identity, i.onchain_status, i.onchain_error, i.onchain_attempts
       FROM identities i
       JOIN users u ON u.id = i.user_id`;

function toRecord(row: IdentityRow): IdentityRecord {
  return {
    walletAddress: row.wallet_address,
    onchainIdAddress: row.onchainid_address,
    countryCode: row.country_code,
    kycStatus: row.kyc_status,
    applicantId: row.sumsub_applicant_id,
    claims: row.kyc_status === 'approved' ? [1, 2] : [],
    onchain: {
      status: row.onchain_status,
      identityAddress: row.onchain_identity,
      error: row.onchain_error,
      attempts: row.onchain_attempts,
    },
  };
}

function toEvent(row: EventRow): KycEvent {
  return {
    applicantId: row.applicant_id,
    eventType: row.event_type,
    reviewAnswer: row.review_answer,
    countryCode: row.country_code,
    status: row.status,
    reason: row.payload?.reason ?? null,
    payload: row.payload?.webhook ?? {},
    receivedAt: row.created_at,
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
      `INSERT INTO audit_log (actor, action, payload)
       VALUES ('sumsub', 'kyc.reviewed', $1::jsonb)`,
      [JSON.stringify({ applicantId: record.applicantId, status: record.kycStatus })],
    );

    return record;
  }

  async getByApplicant(applicantId: string) {
    const result = await this.client.query<IdentityRow>(`${IDENTITY_SELECT} WHERE i.sumsub_applicant_id = $1`, [
      applicantId,
    ]);
    const row = result.rows[0];
    return row ? toRecord(row) : undefined;
  }

  async getByWallet(wallet: string) {
    const result = await this.client.query<IdentityRow>(`${IDENTITY_SELECT} WHERE u.wallet_address = $1`, [
      wallet.toLowerCase(),
    ]);
    const row = result.rows[0];
    return row ? toRecord(row) : undefined;
  }

  async list(filter: IdentityFilter = {}) {
    const result = filter.status
      ? await this.client.query<IdentityRow>(`${IDENTITY_SELECT} WHERE i.kyc_status = $1 ORDER BY i.created_at`, [
          filter.status,
        ])
      : await this.client.query<IdentityRow>(`${IDENTITY_SELECT} ORDER BY i.created_at`);
    return result.rows.map(toRecord);
  }

  async listForOnboarding(limit = 20) {
    const result = await this.client.query<IdentityRow>(
      `${IDENTITY_SELECT}
       WHERE i.kyc_status = 'approved' AND i.onchain_status IN ('pending', 'identity_deployed')
       ORDER BY i.created_at
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(toRecord);
  }

  async updateOnchain(walletAddress: string, registration: OnchainRegistration) {
    await this.client.query(
      `UPDATE identities i
       SET onchain_identity = $2, onchain_status = $3, onchain_error = $4, onchain_attempts = $5, onchain_updated_at = now()
       FROM users u
       WHERE u.id = i.user_id AND u.wallet_address = $1`,
      [
        walletAddress.toLowerCase(),
        registration.identityAddress?.toLowerCase() ?? null,
        registration.status,
        registration.error,
        registration.attempts,
      ],
    );
  }

  /** kyc_events is a delivery log. One row per webhook POST, including ignored types. */
  async recordEvent(event: KycEvent) {
    await this.client.query(
      `INSERT INTO kyc_events (applicant_id, event_type, review_answer, country_code, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        event.applicantId,
        event.eventType,
        event.reviewAnswer,
        event.countryCode,
        event.status,
        JSON.stringify({ reason: event.reason, webhook: event.payload }),
        event.receivedAt,
      ],
    );
  }

  async listEvents(applicantId: string) {
    const result = await this.client.query<EventRow>(
      `SELECT applicant_id, event_type, review_answer, country_code, status, payload, created_at
       FROM kyc_events
       WHERE applicant_id = $1
       ORDER BY created_at`,
      [applicantId],
    );
    return result.rows.map(toEvent);
  }
}
