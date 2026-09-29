import { createHmac } from 'node:crypto';

import type { ApplicantSnapshot } from './parseWebhook.ts';

type SumsubEnv = {
  SUMSUB_APP_TOKEN?: string;
  SUMSUB_SECRET_KEY?: string;
  SUMSUB_BASE_URL?: string;
  SUMSUB_LEVEL_NAME?: string;
};

/** Verification level Eqowa confirmed on 30 September 2026: ID document plus liveness. */
export const DEFAULT_SUMSUB_LEVEL = 'id-and-liveness';

/** A WebSDK access token lives this long; the SDK asks for a fresh one when it expires. */
export const SDK_TOKEN_TTL_SECONDS = 30 * 60;

/** Sumsub request signature: HMAC-SHA256 of timestamp, method, path with query, and body. */
export function signSumsubRequest(input: { ts: string; method: string; path: string; body?: string; secret: string }) {
  return createHmac('sha256', input.secret)
    .update(`${input.ts}${input.method.toUpperCase()}${input.path}${input.body ?? ''}`)
    .digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * GET /resources/applicants/{id}/one when sandbox keys are set.
 * Returns null when keys are missing so the webhook can still mock locally.
 */
export async function fetchSumsubApplicant(
  applicantId: string,
  env: SumsubEnv = process.env,
): Promise<ApplicantSnapshot | null> {
  const token = env.SUMSUB_APP_TOKEN;
  const secret = env.SUMSUB_SECRET_KEY;
  if (!token || !secret) {
    return null;
  }

  const path = `/resources/applicants/${encodeURIComponent(applicantId)}/one`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signSumsubRequest({ ts, method: 'GET', path, secret });
  const base = env.SUMSUB_BASE_URL ?? 'https://api.sumsub.com';

  const response = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-App-Token': token,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': sig,
    },
  });

  if (!response.ok) {
    return null;
  }

  const body = asRecord(await response.json());
  if (!body) {
    return null;
  }
  const info = asRecord(body.info);
  return {
    country: asString(info?.country),
    externalUserId: asString(body.externalUserId),
  };
}

export class SumsubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Access token for the WebSDK, bound to `userId`. The user id is the investor's
 * wallet: Sumsub sends it back as externalUserId on every webhook, which is how
 * a review result reaches the right wallet. Null when the keys are not set.
 */
export async function createSumsubAccessToken(
  input: { userId: string; levelName?: string; ttlInSecs?: number },
  env: SumsubEnv = process.env,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<{ token: string; userId: string; levelName: string } | null> {
  const appToken = env.SUMSUB_APP_TOKEN;
  const secret = env.SUMSUB_SECRET_KEY;
  if (!appToken || !secret) {
    return null;
  }

  const levelName = input.levelName ?? env.SUMSUB_LEVEL_NAME ?? DEFAULT_SUMSUB_LEVEL;
  const path = '/resources/accessTokens/sdk';
  const body = JSON.stringify({ userId: input.userId, levelName, ttlInSecs: input.ttlInSecs ?? SDK_TOKEN_TTL_SECONDS });
  const ts = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000).toString();
  const base = env.SUMSUB_BASE_URL ?? 'https://api.sumsub.com';

  const response = await (deps.fetch ?? fetch)(`${base}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-App-Token': appToken,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': signSumsubRequest({ ts, method: 'POST', path, body, secret }),
    },
    body,
  });
  if (!response.ok) {
    throw new SumsubError(response.status, `Sumsub access token request failed with ${response.status}`);
  }
  const json = asRecord(await response.json());
  const token = asString(json?.token);
  if (!token) {
    throw new SumsubError(502, 'Sumsub returned no access token');
  }
  return { token, userId: input.userId, levelName };
}
