import type { FastifyInstance } from 'fastify';

import { inviteAdmin, type AdminActor, type AuditWriter, type createAdminGuard } from './adminAuth.ts';
import type { AdminStore } from './adminStore.ts';
import type { RecoveryStore, RecoveryTicket } from './recoveryStore.ts';

/** Evidence that the Safe signers agreed: the hash of their Safe transaction or message. */
export const SAFE_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_REASON = 300;

export type RecoveryError =
  'invalid_safe_tx' | 'unknown_ticket' | 'already_resolved' | 'self_approval' | 'requester_approval' | 'unknown_admin';

/**
 * Break-glass reset for an admin who lost their keys: every key is removed,
 * the account returns to invited, and a fresh single-use invite is issued.
 * Two different people are involved (the one who opened the ticket and the
 * one approving it), neither may be the admin being reset, and the Safe
 * signers' agreement is recorded as a transaction hash.
 */
export async function approveRecovery(input: {
  tickets: RecoveryStore;
  admins: AdminStore;
  ticketId: string;
  approver: Pick<AdminActor, 'actor' | 'adminId'>;
  safeTxHash: string;
  webOrigin: string;
  audit: AuditWriter;
  now: Date;
}): Promise<{ ticket: RecoveryTicket; inviteUrl: string; expiresAt: Date } | { error: RecoveryError }> {
  if (!SAFE_TX_HASH.test(input.safeTxHash)) {
    return { error: 'invalid_safe_tx' };
  }
  const ticket = await input.tickets.get(input.ticketId);
  if (!ticket) {
    return { error: 'unknown_ticket' };
  }
  if (ticket.status !== 'open') {
    return { error: 'already_resolved' };
  }
  if (input.approver.adminId && input.approver.adminId === ticket.adminId) {
    return { error: 'self_approval' };
  }
  if (input.approver.actor === ticket.requestedBy) {
    return { error: 'requester_approval' };
  }
  const admin = await input.admins.getAdmin(ticket.adminId);
  if (!admin) {
    return { error: 'unknown_admin' };
  }

  // Close the ticket first: only one approval can win, so keys are reset once.
  const closed = await input.tickets.resolve(ticket.id, {
    status: 'approved',
    resolvedBy: input.approver.actor,
    safeTxHash: input.safeTxHash,
    resolution: 'keys reset, new invite issued',
    now: input.now,
  });
  if (!closed) {
    return { error: 'already_resolved' };
  }

  const credentials = await input.admins.listCredentials(admin.id);
  for (const credential of credentials) {
    await input.admins.removeCredential(credential.id);
  }
  // Back to invited: any session still open for this admin stops working at once.
  await input.admins.setStatus(admin.id, 'invited');
  const invite = await inviteAdmin({
    store: input.admins,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    createdBy: input.approver.actor,
    webOrigin: input.webOrigin,
    now: input.now,
  });
  if ('error' in invite) {
    throw new Error(`re-invite failed: ${invite.error}`);
  }
  await input.audit({
    actor: input.approver.actor,
    action: 'admin.recovered',
    payload: {
      ticketId: ticket.id,
      adminId: admin.id,
      email: admin.email,
      removedKeys: credentials.length,
      safeTxHash: input.safeTxHash,
      requestedBy: ticket.requestedBy,
    },
  });
  return { ticket: (await input.tickets.get(ticket.id))!, inviteUrl: invite.inviteUrl, expiresAt: invite.expiresAt };
}

const ERROR_STATUS: Record<RecoveryError, number> = {
  invalid_safe_tx: 400,
  unknown_ticket: 404,
  already_resolved: 409,
  self_approval: 403,
  requester_approval: 403,
  unknown_admin: 404,
};

export function registerRecoveryRoutes(
  app: FastifyInstance,
  deps: {
    guard: ReturnType<typeof createAdminGuard>;
    admins: AdminStore;
    tickets: RecoveryStore;
    audit: AuditWriter;
    webOrigin: string;
    now: () => Date;
  },
) {
  async function withAdmin(ticket: RecoveryTicket) {
    const admin = await deps.admins.getAdmin(ticket.adminId);
    return {
      id: ticket.id,
      admin: admin ? { id: admin.id, email: admin.email, name: admin.name, role: admin.role } : null,
      requestedBy: ticket.requestedBy,
      reason: ticket.reason,
      status: ticket.status,
      safeTxHash: ticket.safeTxHash,
      resolvedBy: ticket.resolvedBy,
      resolution: ticket.resolution,
      createdAt: ticket.createdAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    };
  }

  app.get('/admin/recovery', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'recovery:request'))) {
      return reply;
    }
    return { ok: true, tickets: await Promise.all((await deps.tickets.list()).map(withAdmin)) };
  });

  app.post('/admin/recovery', async (request, reply) => {
    const actor = await deps.guard.authorize(request, reply, 'recovery:request');
    if (!actor) {
      return reply;
    }
    const body = (request.body ?? {}) as { adminId?: unknown; reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const admin = typeof body.adminId === 'string' ? await deps.admins.getAdmin(body.adminId) : undefined;
    if (!admin || admin.status === 'disabled') {
      return reply.code(404).send({ ok: false, reason: 'unknown_admin' });
    }
    if (!reason || reason.length > MAX_REASON) {
      return reply.code(400).send({ ok: false, reason: 'reason_required' });
    }
    if (await deps.tickets.openFor(admin.id)) {
      return reply.code(409).send({ ok: false, reason: 'ticket_open' });
    }
    const ticket = await deps.tickets.open({ adminId: admin.id, requestedBy: actor.actor, reason, now: deps.now() });
    await deps.audit({
      actor: actor.actor,
      action: 'admin.recovery_requested',
      payload: { ticketId: ticket.id, adminId: admin.id, email: admin.email, reason },
    });
    return { ok: true, ticket: await withAdmin(ticket) };
  });

  app.post('/admin/recovery/:id/approve', async (request, reply) => {
    const approver = await deps.guard.authorize(request, reply, 'recovery:approve');
    if (!approver) {
      return reply;
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { safeTxHash?: unknown };
    const result = await approveRecovery({
      tickets: deps.tickets,
      admins: deps.admins,
      ticketId: id,
      approver,
      safeTxHash: typeof body.safeTxHash === 'string' ? body.safeTxHash.trim() : '',
      webOrigin: deps.webOrigin,
      audit: deps.audit,
      now: deps.now(),
    });
    if ('error' in result) {
      return reply.code(ERROR_STATUS[result.error]).send({ ok: false, reason: result.error });
    }
    reply.header('cache-control', 'no-store');
    return {
      ok: true,
      ticket: await withAdmin(result.ticket),
      inviteUrl: result.inviteUrl,
      expiresAt: result.expiresAt.toISOString(),
    };
  });

  app.post('/admin/recovery/:id/reject', async (request, reply) => {
    const approver = await deps.guard.authorize(request, reply, 'recovery:approve');
    if (!approver) {
      return reply;
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > MAX_REASON) {
      return reply.code(400).send({ ok: false, reason: 'reason_required' });
    }
    const closed = await deps.tickets.resolve(id, {
      status: 'rejected',
      resolvedBy: approver.actor,
      safeTxHash: null,
      resolution: reason,
      now: deps.now(),
    });
    if (!closed) {
      return reply.code((await deps.tickets.get(id)) ? 409 : 404).send({ ok: false, reason: 'not_open' });
    }
    await deps.audit({ actor: approver.actor, action: 'admin.recovery_rejected', payload: { ticketId: id, reason } });
    return { ok: true, ticket: await withAdmin((await deps.tickets.get(id))!) };
  });
}
