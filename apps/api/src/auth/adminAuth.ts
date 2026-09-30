import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  ADMIN_ROLES,
  ROLE_PERMISSIONS,
  can,
  isAdminRole,
  type AdminPermission,
  type AdminRole,
} from '../../../../config/adminRoles.ts';

import type { AdminStore, AdminUser } from './adminStore.ts';
import type { NonceStore } from './nonceStore.ts';
import {
  ADMIN_SESSION_SECONDS,
  parseCookies,
  serializeCookie,
  signAdminSession,
  verifyAdminSession,
} from './session.ts';

export type AdminAuthConfig = {
  secret: string;
  cookieName: string;
  secureCookie: boolean;
  /** WebAuthn relying party: the web host, e.g. app.eqowa.com or localhost. */
  rpID: string;
  rpName: string;
  /** Origin the browser reports, e.g. https://app.eqowa.com or http://localhost:3000. */
  origin: string;
};

export type AuditWriter = (entry: { actor: string; action: string; payload: Record<string, unknown> }) => Promise<void>;

/** Who is acting. A legacy x-admin-key caller acts as operations until handover. */
export type AdminActor = { actor: string; role: AdminRole; adminId: string | null };

export const INVITE_TTL_SECONDS = 72 * 60 * 60;
export const CHALLENGE_TTL_SECONDS = 5 * 60;
/** Two keys are the target; a few more leave room for a spare and a replacement. */
export const MAX_CREDENTIALS = 5;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function toAdminDto(admin: AdminUser) {
  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role, status: admin.status };
}

/**
 * Creates the admin if needed and a single-use enrolment link. Used by the
 * team page and by the bootstrap CLI for the very first admin.
 */
export async function inviteAdmin(input: {
  store: AdminStore;
  email: string;
  name: string;
  role: AdminRole;
  createdBy: string;
  webOrigin: string;
  now: Date;
}): Promise<{ admin: AdminUser; inviteUrl: string; expiresAt: Date } | { error: 'admin_active' | 'invalid_email' }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'invalid_email' };
  }
  let admin = await input.store.getAdminByEmail(email);
  if (admin && admin.status !== 'invited') {
    // Replacing keys of an active admin is the break-glass flow (M4-12), not a new invite.
    return { error: 'admin_active' };
  }
  admin ??= await input.store.createAdmin({ email, name: input.name || email, role: input.role, now: input.now });

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(input.now.getTime() + INVITE_TTL_SECONDS * 1000);
  await input.store.createInvite({
    tokenHash: hashInviteToken(token),
    adminId: admin.id,
    expiresAt,
    consumedAt: null,
    createdBy: input.createdBy,
  });
  const url = new URL('/admin/enrol', input.webOrigin);
  url.searchParams.set('token', token);
  return { admin, inviteUrl: url.toString(), expiresAt };
}

/**
 * Admin access for every /admin route: a WebAuthn session cookie, or the
 * legacy x-admin-key (acting as operations) kept until handover. Role and
 * status come from the store on every request, so a disabled admin or a
 * changed role takes effect at once, not when the session expires.
 */
export function createAdminGuard(deps: {
  adminAuth?: AdminAuthConfig;
  adminStore: AdminStore;
  adminKey: string;
  now: () => Date;
}) {
  async function sessionAdmin(request: FastifyRequest): Promise<AdminUser | null> {
    if (!deps.adminAuth) {
      return null;
    }
    const token = parseCookies(request.headers.cookie)[deps.adminAuth.cookieName];
    const session = token ? verifyAdminSession(token, deps.adminAuth.secret, deps.now()) : null;
    if (!session) {
      return null;
    }
    const admin = await deps.adminStore.getAdmin(session.adminId);
    return admin?.status === 'active' ? admin : null;
  }

  async function authorize(
    request: FastifyRequest,
    reply: FastifyReply,
    permission: AdminPermission,
  ): Promise<AdminActor | null> {
    if (!deps.adminAuth && !deps.adminKey) {
      void reply.code(503).send({ ok: false, reason: 'admin_unconfigured' });
      return null;
    }

    const admin = await sessionAdmin(request);
    let actor: AdminActor | null = admin ? { actor: admin.email, role: admin.role, adminId: admin.id } : null;

    if (!actor && deps.adminKey) {
      const header = request.headers['x-admin-key'];
      if (typeof header === 'string' && sameSecret(header, deps.adminKey)) {
        const named = request.headers['x-admin-actor'];
        actor = {
          actor: typeof named === 'string' && named.trim() ? named.trim() : 'admin',
          role: 'operations',
          adminId: null,
        };
      }
    }

    if (!actor) {
      void reply.code(401).send({ ok: false, reason: 'unauthorized' });
      return null;
    }
    if (!can(actor.role, permission)) {
      void reply.code(403).send({ ok: false, reason: 'forbidden', permission });
      return null;
    }
    return actor;
  }

  return { authorize, sessionAdmin };
}

export function registerAdminAuthRoutes(
  app: FastifyInstance,
  deps: {
    adminAuth?: AdminAuthConfig;
    adminStore: AdminStore;
    nonces: NonceStore;
    guard: ReturnType<typeof createAdminGuard>;
    audit: AuditWriter;
    webOrigin: string;
    now: () => Date;
  },
) {
  const unconfigured = (reply: FastifyReply) => reply.code(503).send({ ok: false, reason: 'admin_auth_unconfigured' });

  async function issueChallenge(purpose: 'reg' | 'login', adminId: string, challenge: string) {
    const now = deps.now();
    await deps.nonces.issue(
      `${purpose}:${adminId}:${challenge}`,
      new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000),
      now,
    );
  }

  /** Single use: the challenge is spent the moment the library checks it. */
  const challengeCheck = (purpose: 'reg' | 'login', adminId: string) => (challenge: string) =>
    deps.nonces.consume(`${purpose}:${adminId}:${challenge}`, deps.now());

  function startSession(reply: FastifyReply, auth: AdminAuthConfig, adminId: string) {
    const now = deps.now();
    reply.header(
      'set-cookie',
      serializeCookie(
        auth.cookieName,
        signAdminSession(
          { kind: 'admin', adminId, issuedAt: now, expiresAt: new Date(now.getTime() + ADMIN_SESSION_SECONDS * 1000) },
          auth.secret,
        ),
        { maxAgeSeconds: ADMIN_SESSION_SECONDS, secure: auth.secureCookie },
      ),
    );
  }

  /** Enrolment either by invite token (first key) or by an existing session (another key). */
  async function enrollingAdmin(request: FastifyRequest, token: string) {
    if (token) {
      const invite = await deps.adminStore.findInvite(hashInviteToken(token), deps.now());
      const admin = invite ? await deps.adminStore.getAdmin(invite.adminId) : undefined;
      return admin && admin.status !== 'disabled' ? { admin, viaInvite: true } : null;
    }
    const admin = await deps.guard.sessionAdmin(request);
    return admin ? { admin, viaInvite: false } : null;
  }

  app.post('/auth/admin/invite/inspect', async (request, reply) => {
    const token = asString(asRecord(request.body).token);
    const invite = token ? await deps.adminStore.findInvite(hashInviteToken(token), deps.now()) : undefined;
    const admin = invite ? await deps.adminStore.getAdmin(invite.adminId) : undefined;
    if (!invite || !admin) {
      return reply.code(404).send({ ok: false, reason: 'invalid_invite' });
    }
    return { ok: true, admin: toAdminDto(admin), expiresAt: invite.expiresAt.toISOString() };
  });

  app.post('/auth/admin/register/options', async (request, reply) => {
    const auth = deps.adminAuth;
    if (!auth) {
      return unconfigured(reply);
    }
    const enrolling = await enrollingAdmin(request, asString(asRecord(request.body).token));
    if (!enrolling) {
      return reply.code(401).send({ ok: false, reason: 'invalid_invite' });
    }
    const existing = await deps.adminStore.listCredentials(enrolling.admin.id);
    if (existing.length >= MAX_CREDENTIALS) {
      return reply.code(409).send({ ok: false, reason: 'too_many_credentials' });
    }
    const options = await generateRegistrationOptions({
      rpName: auth.rpName,
      rpID: auth.rpID,
      userName: enrolling.admin.email,
      userDisplayName: enrolling.admin.name,
      userID: new TextEncoder().encode(enrolling.admin.id),
      attestationType: 'none',
      // The same key cannot be enrolled twice for one admin.
      excludeCredentials: existing.map((item) => ({ id: item.id, transports: item.transports })),
      // Email-first login, so keys need not store a resident credential (YubiKey slots are few).
      authenticatorSelection: { residentKey: 'discouraged', userVerification: 'preferred' },
    });
    await issueChallenge('reg', enrolling.admin.id, options.challenge);
    reply.header('cache-control', 'no-store');
    return { ok: true, options };
  });

  app.post('/auth/admin/register/verify', async (request, reply) => {
    const auth = deps.adminAuth;
    if (!auth) {
      return unconfigured(reply);
    }
    const body = asRecord(request.body);
    const token = asString(body.token);
    const enrolling = await enrollingAdmin(request, token);
    if (!enrolling) {
      return reply.code(401).send({ ok: false, reason: 'invalid_invite' });
    }
    const response = body.response as RegistrationResponseJSON | undefined;
    if (!response || typeof response !== 'object') {
      return reply.code(400).send({ ok: false, reason: 'invalid_response' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challengeCheck('reg', enrolling.admin.id),
        expectedOrigin: auth.origin,
        expectedRPID: auth.rpID,
        requireUserVerification: false,
      });
    } catch (error) {
      request.log.warn({ err: error, admin: enrolling.admin.email }, 'admin key enrolment rejected');
      return reply.code(401).send({ ok: false, reason: 'invalid_response' });
    }
    if (!verification.verified) {
      return reply.code(401).send({ ok: false, reason: 'invalid_response' });
    }

    const now = deps.now();
    if (enrolling.viaInvite && !(await deps.adminStore.consumeInvite(hashInviteToken(token), now))) {
      return reply.code(409).send({ ok: false, reason: 'invite_used' });
    }
    const { credential } = verification.registrationInfo;
    const label = asString(body.label).slice(0, 60) || 'Security key';
    await deps.adminStore.addCredential({
      id: credential.id,
      adminId: enrolling.admin.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? response.response.transports ?? [],
      label,
      createdAt: now,
      lastUsedAt: null,
    });
    if (enrolling.admin.status === 'invited') {
      await deps.adminStore.setStatus(enrolling.admin.id, 'active');
    }
    await deps.audit({
      actor: enrolling.admin.email,
      action: 'admin.credential_added',
      payload: { adminId: enrolling.admin.id, label, viaInvite: enrolling.viaInvite },
    });
    startSession(reply, auth, enrolling.admin.id);
    return { ok: true };
  });

  app.post('/auth/admin/login/options', async (request, reply) => {
    const auth = deps.adminAuth;
    if (!auth) {
      return unconfigured(reply);
    }
    const admin = await deps.adminStore.getAdminByEmail(asString(asRecord(request.body).email));
    const active = admin?.status === 'active' ? admin : undefined;
    const credentials = active ? await deps.adminStore.listCredentials(active.id) : [];
    // Unknown and active emails get the same shape of answer, so the page does
    // not reveal who is an admin.
    const options = await generateAuthenticationOptions({
      rpID: auth.rpID,
      allowCredentials: credentials.map((item) => ({ id: item.id, transports: item.transports })),
      userVerification: 'preferred',
    });
    if (active) {
      await issueChallenge('login', active.id, options.challenge);
    }
    reply.header('cache-control', 'no-store');
    return { ok: true, options };
  });

  app.post('/auth/admin/login/verify', async (request, reply) => {
    const auth = deps.adminAuth;
    if (!auth) {
      return unconfigured(reply);
    }
    const body = asRecord(request.body);
    const response = body.response as AuthenticationResponseJSON | undefined;
    const admin = await deps.adminStore.getAdminByEmail(asString(body.email));
    const credential =
      response && typeof response.id === 'string' ? await deps.adminStore.getCredential(response.id) : undefined;
    // One answer for every failure, so a caller learns nothing about accounts or keys.
    const refuse = (why: string) => {
      request.log.warn({ why, email: asString(body.email) }, 'admin login rejected');
      return reply.code(401).send({ ok: false, reason: 'invalid_login' });
    };
    if (!admin || admin.status !== 'active' || !credential || credential.adminId !== admin.id || !response) {
      return refuse('unknown admin or key');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeCheck('login', admin.id),
        expectedOrigin: auth.origin,
        expectedRPID: auth.rpID,
        credential: {
          id: credential.id,
          publicKey: credential.publicKey,
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: false,
      });
    } catch (error) {
      return refuse(error instanceof Error ? error.message : 'verification error');
    }
    if (!verification.verified) {
      return refuse('signature');
    }

    await deps.adminStore.recordUse(credential.id, verification.authenticationInfo.newCounter, deps.now());
    await deps.audit({
      actor: admin.email,
      action: 'admin.login',
      payload: { adminId: admin.id, credential: credential.label },
    });
    startSession(reply, auth, admin.id);
    return { ok: true, admin: toAdminDto(admin) };
  });

  app.get('/auth/admin/me', async (request, reply) => {
    if (!deps.adminAuth) {
      return unconfigured(reply);
    }
    const admin = await deps.guard.sessionAdmin(request);
    if (!admin) {
      return reply.code(401).send({ ok: false, reason: 'unauthenticated' });
    }
    const credentials = await deps.adminStore.listCredentials(admin.id);
    return {
      ok: true,
      admin: toAdminDto(admin),
      permissions: [...ROLE_PERMISSIONS[admin.role]],
      credentials: credentials.map((item) => ({
        id: item.id,
        label: item.label,
        createdAt: item.createdAt.toISOString(),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      })),
      // Admin policy: two keys each, so a lost key is not a lock-out.
      needsSecondKey: credentials.length < 2,
    };
  });

  app.post('/auth/admin/logout', async (_request, reply) => {
    if (!deps.adminAuth) {
      return unconfigured(reply);
    }
    reply.header(
      'set-cookie',
      serializeCookie(deps.adminAuth.cookieName, '', { maxAgeSeconds: 0, secure: deps.adminAuth.secureCookie }),
    );
    return { ok: true };
  });

  app.delete('/auth/admin/credentials/:id', async (request, reply) => {
    if (!deps.adminAuth) {
      return unconfigured(reply);
    }
    const admin = await deps.guard.sessionAdmin(request);
    if (!admin) {
      return reply.code(401).send({ ok: false, reason: 'unauthenticated' });
    }
    const { id } = request.params as { id: string };
    const credentials = await deps.adminStore.listCredentials(admin.id);
    const target = credentials.find((item) => item.id === id);
    if (!target) {
      return reply.code(404).send({ ok: false, reason: 'unknown_credential' });
    }
    if (credentials.length <= 1) {
      return reply.code(409).send({ ok: false, reason: 'last_credential' });
    }
    await deps.adminStore.removeCredential(id);
    await deps.audit({
      actor: admin.email,
      action: 'admin.credential_removed',
      payload: { adminId: admin.id, label: target.label },
    });
    return { ok: true };
  });

  app.get('/admin/team', async (request, reply) => {
    const actor = await deps.guard.authorize(request, reply, 'team:view');
    if (!actor) {
      return reply;
    }
    const admins = await deps.adminStore.listAdmins();
    const counts = await Promise.all(admins.map((admin) => deps.adminStore.listCredentials(admin.id)));
    return {
      ok: true,
      team: admins.map((admin, index) => ({ ...toAdminDto(admin), credentialCount: counts[index].length })),
    };
  });

  app.post('/admin/team/invite', async (request, reply) => {
    const actor = await deps.guard.authorize(request, reply, 'team:manage');
    if (!actor) {
      return reply;
    }
    const body = asRecord(request.body);
    const role = asString(body.role);
    if (!isAdminRole(role)) {
      return reply.code(400).send({ ok: false, reason: 'invalid_role', roles: ADMIN_ROLES });
    }
    const result = await inviteAdmin({
      store: deps.adminStore,
      email: asString(body.email),
      name: asString(body.name),
      role,
      createdBy: actor.actor,
      webOrigin: deps.webOrigin,
      now: deps.now(),
    });
    if ('error' in result) {
      return reply.code(result.error === 'admin_active' ? 409 : 400).send({ ok: false, reason: result.error });
    }
    await deps.audit({
      actor: actor.actor,
      action: 'admin.invited',
      payload: { adminId: result.admin.id, email: result.admin.email, role: result.admin.role },
    });
    reply.header('cache-control', 'no-store');
    return {
      ok: true,
      admin: toAdminDto(result.admin),
      inviteUrl: result.inviteUrl,
      expiresAt: result.expiresAt.toISOString(),
    };
  });
}
