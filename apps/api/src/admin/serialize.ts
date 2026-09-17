import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuditEntry, ExceptionRecord } from '../../../../config/exceptions.ts';
import type { IdentityRecord, KycEvent } from '../kyc/identityStore.ts';

export function serializeException(row: ExceptionRecord) {
  return {
    id: row.id,
    kind: row.kind,
    intentId: row.intentId,
    status: row.status,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy ?? null,
    resolution: row.resolution ?? null,
  };
}

export function serializeAudit(row: AuditEntry) {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

export function adminUnauthorized(request: FastifyRequest, reply: FastifyReply, adminKey: string) {
  if (!adminKey) {
    return reply.code(503).send({ ok: false, reason: 'admin_unconfigured' });
  }
  const header = request.headers['x-admin-key'];
  const provided = typeof header === 'string' ? header : '';
  if (provided !== adminKey) {
    return reply.code(401).send({ ok: false, reason: 'unauthorized' });
  }
  return null;
}

export function serializeIdentity(row: IdentityRecord) {
  return {
    applicantId: row.applicantId,
    walletAddress: row.walletAddress,
    onchainIdAddress: row.onchainIdAddress,
    countryCode: row.countryCode,
    kycStatus: row.kycStatus,
    claims: row.claims,
  };
}

export function serializeKycEvent(row: KycEvent) {
  return {
    applicantId: row.applicantId,
    type: row.eventType,
    reviewAnswer: row.reviewAnswer,
    countryCode: row.countryCode,
    status: row.status,
    reason: row.reason,
    receivedAt: row.receivedAt.toISOString(),
    payload: row.payload,
  };
}
