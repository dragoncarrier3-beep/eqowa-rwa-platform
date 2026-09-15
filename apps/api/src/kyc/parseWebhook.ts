import { getAddress, isAddress } from 'ethers';

export type ApplicantSnapshot = {
  country?: string;
  externalUserId?: string;
};

export type ParsedSumsubWebhook = {
  type: string;
  applicantId: string;
  externalUserId?: string;
  reviewAnswer?: string;
  country?: string;
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

function nestedCountry(body: Record<string, unknown>): string | undefined {
  const info = asRecord(body.info);
  const applicant = asRecord(body.applicant);
  const applicantInfo = applicant ? asRecord(applicant.info) : null;
  return asString(info?.country) ?? asString(applicantInfo?.country);
}

/** Read the Sumsub callback fields we need. Unknown shapes return null. */
export function parseSumsubWebhook(body: unknown): ParsedSumsubWebhook | null {
  const record = asRecord(body);
  if (!record) {
    return null;
  }

  const type = asString(record.type);
  const applicantId = asString(record.applicantId);
  if (!type || !applicantId) {
    return null;
  }

  const review = asRecord(record.reviewResult);
  return {
    type,
    applicantId,
    externalUserId: asString(record.externalUserId),
    reviewAnswer: asString(review?.reviewAnswer),
    country: nestedCountry(record),
  };
}

export function parseWalletAddress(value: string | undefined): string | null {
  if (!value || !isAddress(value)) {
    return null;
  }
  return getAddress(value);
}

export function mergeApplicant(webhook: ParsedSumsubWebhook, snapshot: ApplicantSnapshot | null): ParsedSumsubWebhook {
  return {
    ...webhook,
    externalUserId: webhook.externalUserId ?? snapshot?.externalUserId,
    country: webhook.country ?? snapshot?.country,
  };
}
