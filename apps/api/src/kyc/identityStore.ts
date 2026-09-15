export type IdentityRecord = {
  walletAddress: string;
  onchainIdAddress: string;
  countryCode: number | null;
  kycStatus: 'pending' | 'approved' | 'rejected' | 'blocked_country';
  applicantId: string;
  claims: number[];
};

export interface IdentityStore {
  recordKyc(record: IdentityRecord): Promise<IdentityRecord>;
  getByApplicant(applicantId: string): Promise<IdentityRecord | undefined>;
  getByWallet(wallet: string): Promise<IdentityRecord | undefined>;
}

/** In-memory store used by tests and when DATABASE_URL is unset. */
export class MemoryIdentityStore implements IdentityStore {
  readonly records: IdentityRecord[] = [];

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
}
