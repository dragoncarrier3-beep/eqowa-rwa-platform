import { ISSUED_CLAIM_TOPICS, mockOnchainId } from '../../../../config/claims.ts';
import { decideKyc } from '../../../../config/kyc.ts';
import { parseCountryCode } from '../../../../config/iso3166.ts';

import type { IdentityRecord, IdentityStore } from './identityStore.ts';
import { mergeApplicant, parseSumsubWebhook, parseWalletAddress, type ApplicantSnapshot } from './parseWebhook.ts';

export type ApplicantLookup = (applicantId: string) => Promise<ApplicantSnapshot | null>;

export type KycApplyResult = {
  status: 'approved' | 'rejected' | 'ignored';
  reason?: string;
  identity?: IdentityRecord;
};

/**
 * Turn an applicantReviewed webhook into claims 1 and 2 (mock ONCHAINID until
 * the Amoy suite addresses are in env). Other event types are ignored.
 */
export async function applySumsubWebhook(params: {
  payload: unknown;
  store: IdentityStore;
  lookupApplicant?: ApplicantLookup;
}): Promise<KycApplyResult> {
  const parsed = parseSumsubWebhook(params.payload);
  if (!parsed) {
    return { status: 'ignored', reason: 'malformed' };
  }
  if (parsed.type !== 'applicantReviewed') {
    return { status: 'ignored', reason: parsed.type };
  }

  let snapshot: ApplicantSnapshot | null = null;
  if (params.lookupApplicant) {
    snapshot = await params.lookupApplicant(parsed.applicantId);
  }
  const merged = mergeApplicant(parsed, snapshot);
  const wallet = parseWalletAddress(merged.externalUserId);
  if (!wallet) {
    return { status: 'rejected', reason: 'missing_wallet' };
  }

  const countryCode = parseCountryCode(merged.country);
  const decision = decideKyc(merged.reviewAnswer, countryCode);

  if (decision.action === 'issue') {
    const identity: IdentityRecord = {
      walletAddress: wallet,
      onchainIdAddress: mockOnchainId(wallet),
      countryCode: decision.countryCode,
      kycStatus: 'approved',
      applicantId: parsed.applicantId,
      claims: ISSUED_CLAIM_TOPICS.map((topic) => Number(topic)),
    };
    await params.store.recordKyc(identity);
    return { status: 'approved', identity };
  }

  const kycStatus = decision.reason === 'blocked_country' ? 'blocked_country' : 'rejected';
  const identity: IdentityRecord = {
    walletAddress: wallet,
    onchainIdAddress: mockOnchainId(wallet),
    countryCode,
    kycStatus,
    applicantId: parsed.applicantId,
    claims: [],
  };
  await params.store.recordKyc(identity);
  return { status: 'rejected', reason: decision.reason, identity };
}
