export type IdentityRecord = {
  walletAddress: string;
  onchainIdAddress: string;
  countryCode: number | null;
  kycStatus: 'pending' | 'approved' | 'rejected' | 'blocked_country';
  applicantId: string;
  claims: number[];
  /** On-chain registration after approval. Absent until the onboarding worker first sees the record. */
  onchain?: OnchainRegistration;
};

/**
 * pending: approved, waiting for the worker. identity_deployed: an ONCHAINID
 * exists but claims or the registry entry are missing. registered: isVerified
 * is true. failed: gave up after repeated errors or a refusal; ops must act.
 */
export type OnchainStatus = 'pending' | 'identity_deployed' | 'registered' | 'failed';

export type OnchainRegistration = {
  status: OnchainStatus;
  identityAddress: string | null;
  error: string | null;
  attempts: number;
};

/** One Sumsub webhook delivery, stored so ops can see what arrived and what we did with it. */
export type KycEvent = {
  applicantId: string;
  eventType: string;
  reviewAnswer: string | null;
  countryCode: number | null;
  status: 'approved' | 'rejected' | 'ignored';
  reason: string | null;
  payload: Record<string, unknown>;
  receivedAt: Date;
};

export type IdentityFilter = {
  status?: IdentityRecord['kycStatus'];
};

export interface IdentityStore {
  recordKyc(record: IdentityRecord): Promise<IdentityRecord>;
  getByApplicant(applicantId: string): Promise<IdentityRecord | undefined>;
  getByWallet(wallet: string): Promise<IdentityRecord | undefined>;
  list(filter?: IdentityFilter): Promise<IdentityRecord[]>;
  recordEvent(event: KycEvent): Promise<void>;
  listEvents(applicantId: string): Promise<KycEvent[]>;
  /** Approved identities not yet registered on-chain (pending or identity_deployed), oldest first. */
  listForOnboarding(limit?: number): Promise<IdentityRecord[]>;
  updateOnchain(walletAddress: string, registration: OnchainRegistration): Promise<void>;
}

export const NO_REGISTRATION: OnchainRegistration = {
  status: 'pending',
  identityAddress: null,
  error: null,
  attempts: 0,
};

/** In-memory store used by tests and when DATABASE_URL is unset. */
export class MemoryIdentityStore implements IdentityStore {
  readonly records: IdentityRecord[] = [];
  readonly events: KycEvent[] = [];

  async recordKyc(record: IdentityRecord) {
    const applicantKey = record.applicantId;
    const index = this.records.findIndex((item) => item.applicantId === applicantKey);
    const copy = { ...record, claims: [...record.claims] };
    if (index === -1) {
      this.records.push(copy);
    } else {
      // A repeat review never resets the on-chain registration.
      copy.onchain = this.records[index].onchain;
      this.records[index] = copy;
    }
    return copy;
  }

  async getByApplicant(applicantId: string) {
    return this.records.find((item) => item.applicantId === applicantId);
  }

  async getByWallet(wallet: string) {
    const key = wallet.toLowerCase();
    return this.records.find((item) => item.walletAddress.toLowerCase() === key);
  }

  async list(filter: IdentityFilter = {}) {
    return this.records.filter((item) => !filter.status || item.kycStatus === filter.status);
  }

  async listForOnboarding(limit = 20) {
    return this.records
      .filter((item) => {
        const status = item.onchain?.status ?? 'pending';
        return item.kycStatus === 'approved' && (status === 'pending' || status === 'identity_deployed');
      })
      .slice(0, limit)
      .map((item) => ({ ...item, onchain: item.onchain ?? { ...NO_REGISTRATION } }));
  }

  async updateOnchain(walletAddress: string, registration: OnchainRegistration) {
    const key = walletAddress.toLowerCase();
    for (const item of this.records) {
      if (item.walletAddress.toLowerCase() === key) {
        item.onchain = { ...registration };
      }
    }
  }

  async recordEvent(event: KycEvent) {
    this.events.push({ ...event, payload: { ...event.payload } });
  }

  async listEvents(applicantId: string) {
    return this.events
      .filter((item) => item.applicantId === applicantId)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }
}
