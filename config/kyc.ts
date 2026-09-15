import { ALLOWED_COUNTRIES } from './countries';

export type KycRejectReason = 'review_red' | 'blocked_country' | 'unknown_country' | 'missing_wallet';

export type KycDecision = { action: 'issue'; countryCode: number } | { action: 'reject'; reason: KycRejectReason };

/**
 * Sumsub GREEN plus an allow-listed country becomes claims 1 and 2.
 * RED, unknown, or blocked residency (including US) does not get an identity.
 */
export function decideKyc(reviewAnswer: string | undefined, countryCode: number | null): KycDecision {
  const answer = (reviewAnswer ?? '').trim().toUpperCase();
  if (answer !== 'GREEN') {
    return { action: 'reject', reason: 'review_red' };
  }
  if (countryCode === null) {
    return { action: 'reject', reason: 'unknown_country' };
  }
  if (!ALLOWED_COUNTRIES.includes(countryCode)) {
    return { action: 'reject', reason: 'blocked_country' };
  }
  return { action: 'issue', countryCode };
}
