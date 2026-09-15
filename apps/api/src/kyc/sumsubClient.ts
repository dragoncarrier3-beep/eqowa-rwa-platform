import { createHmac } from 'node:crypto';

import type { ApplicantSnapshot } from './parseWebhook.ts';

type SumsubEnv = {
  SUMSUB_APP_TOKEN?: string;
  SUMSUB_SECRET_KEY?: string;
  SUMSUB_BASE_URL?: string;
};

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
  const sig = createHmac('sha256', secret).update(`${ts}GET${path}`).digest('hex');
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
