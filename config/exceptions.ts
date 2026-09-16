export type ExceptionStatus = 'open' | 'resolved';

export type ExceptionRecord = {
  id: string;
  kind: string;
  intentId: string;
  status: ExceptionStatus;
  details: Record<string, unknown>;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: string;
};

export type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/**
 * Close an open exception. There is no reopen path. A second resolve is
 * rejected so the queue cannot silently rewrite an ops decision.
 */
export function applyExceptionResolution(
  record: ExceptionRecord,
  params: { actor: string; resolution: string; now: Date },
): { record: ExceptionRecord } | { error: 'already_resolved' | 'empty_resolution' | 'empty_actor' } {
  const actor = params.actor.trim();
  const resolution = params.resolution.trim();
  if (!actor) {
    return { error: 'empty_actor' };
  }
  if (!resolution) {
    return { error: 'empty_resolution' };
  }
  if (record.status === 'resolved') {
    return { error: 'already_resolved' };
  }

  return {
    record: {
      ...record,
      status: 'resolved',
      resolvedAt: params.now,
      resolvedBy: actor,
      resolution,
    },
  };
}
