import type { ApiError, InvestorMeResponse, KycTokenResponse } from '@config/api';

import { load } from '@/lib/portfolio';
import { proxied } from '@/lib/siwe';

export const fetchInvestorMe = () => load<InvestorMeResponse>('/investor/me');

export class KycTokenError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * A Sumsub WebSDK token for the signed-in wallet. Also used as the SDK's
 * refresh callback, since tokens expire after 30 minutes.
 */
export async function requestKycToken(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(proxied('/investor/kyc/token'), { method: 'POST', cache: 'no-store' });
  } catch {
    throw new KycTokenError('api_unreachable');
  }
  const body = (await response.json().catch(() => ({ ok: false, reason: 'api_unreachable' }))) as
    KycTokenResponse | ApiError;
  if (!body.ok) {
    throw new KycTokenError(response.status === 401 ? 'unauthenticated' : body.reason);
  }
  return body.token;
}

const REASON_TEXT: Record<string, string> = {
  kyc_already_approved: 'Your identity is already verified.',
  kyc_unavailable: 'Identity verification is not available right now. Please try again later.',
  kyc_provider_error: 'The verification service did not respond. Please try again in a moment.',
  unauthenticated: 'Your session ended. Sign in again with your wallet.',
  api_unreachable: 'The platform is not reachable. Please try again shortly.',
};

export function kycErrorText(error: unknown): string {
  if (error instanceof KycTokenError) {
    return REASON_TEXT[error.reason] ?? 'Verification could not start. Please try again.';
  }
  return 'Verification could not start. Please try again.';
}
