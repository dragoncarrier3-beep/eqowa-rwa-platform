export type IdentityRecord = {
  walletAddress: string;
  onchainIdAddress: string;
  countryCode: number | null;
  kycStatus: 'pending' | 'approved' | 'rejected' | 'blocked_country';
  applicantId: string;
  claims: number[];
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
}

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

  async recordEvent(event: KycEvent) {
    this.events.push({ ...event, payload: { ...event.payload } });
  }

  async listEvents(applicantId: string) {
    return this.events
      .filter((item) => item.applicantId === applicantId)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }
}
