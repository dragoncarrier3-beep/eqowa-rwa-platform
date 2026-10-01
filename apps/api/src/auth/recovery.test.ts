import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../index.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';

import { inviteAdmin, type AdminAuthConfig } from './adminAuth.ts';
import { MemoryAdminStore } from './adminStore.ts';
import { MemoryRecoveryStore } from './recoveryStore.ts';
import { SoftKey } from './softKey.ts';

const ORIGIN = 'https://app.eqowa.com';
const NOW = new Date('2026-09-30T13:00:00.000Z');
const SAFE_TX = `0x${'5a'.repeat(32)}`;
const ADMIN_AUTH: AdminAuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_admin',
  secureCookie: true,
  rpID: 'app.eqowa.com',
  rpName: 'EQOWA Admin',
  origin: ORIGIN,
};

async function setup() {
  const adminStore = new MemoryAdminStore();
  const mintStore = new MemoryMintStore();
  const recoveries = new MemoryRecoveryStore();
  const app = buildApp({
    adminAuth: ADMIN_AUTH,
    adminStore,
    mintStore,
    recoveries,
    adminKey: 'legacy-key',
    webOrigin: ORIGIN,
    now: () => NOW,
  });

  /** Invites and enrols one key, returning the session cookie. */
  async function enrolFrom(inviteUrl: string) {
    const token = new URL(inviteUrl).searchParams.get('token')!;
    const key = new SoftKey();
    const { options } = (
      await app.inject({ method: 'POST', url: '/auth/admin/register/options', payload: { token } })
    ).json();
    const verify = await app.inject({
      method: 'POST',
      url: '/auth/admin/register/verify',
      payload: { token, response: key.register(options, ORIGIN) },
    });
    assert.equal(verify.statusCode, 200, verify.body);
    return String(verify.headers['set-cookie']).split(';')[0];
  }

  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const [name, role] of [
    ['larry', 'operations'],
    ['ops2', 'operations'],
    ['legal', 'compliance'],
  ] as const) {
    const invited = await inviteAdmin({
      store: adminStore,
      email: `${name}@eqowa.com`,
      name,
      role,
      createdBy: 'cli',
      webOrigin: ORIGIN,
      now: NOW,
    });
    assert.ok('inviteUrl' in invited);
    ids[name] = invited.admin.id;
    cookies[name] = await enrolFrom(invited.inviteUrl);
  }
  return { app, adminStore, mintStore, cookies, ids, enrolFrom };
}

type Env = Awaited<ReturnType<typeof setup>>;

const post = (env: Env, url: string, payload: unknown, headers: Record<string, string>) =>
  env.app.inject({ method: 'POST', url, payload, headers });

async function openTicket(env: Env, by: string, forAdmin: string) {
  const response = await post(
    env,
    '/admin/recovery',
    { adminId: env.ids[forAdmin], reason: 'Both YubiKeys lost' },
    {
      cookie: env.cookies[by],
    },
  );
  assert.equal(response.statusCode, 200, response.body);
  return response.json().ticket.id as string;
}

test('a colleague opens a ticket, another operations admin approves it with a Safe hash, keys are reset', async () => {
  const env = await setup();
  const ticketId = await openTicket(env, 'legal', 'larry');

  const approved = await post(
    env,
    `/admin/recovery/${ticketId}/approve`,
    { safeTxHash: SAFE_TX },
    { cookie: env.cookies.ops2 },
  );
  assert.equal(approved.statusCode, 200, approved.body);
  const body = approved.json();
  assert.equal(body.ticket.status, 'approved');
  assert.equal(body.ticket.resolvedBy, 'ops2@eqowa.com');
  assert.equal(body.ticket.safeTxHash, SAFE_TX);
  assert.match(body.inviteUrl, /\/admin\/enrol\?token=/);

  // The old keys and any open session of the reset admin stop working at once.
  assert.deepEqual(await env.adminStore.listCredentials(env.ids.larry), []);
  assert.equal((await env.adminStore.getAdmin(env.ids.larry))?.status, 'invited');
  const oldSession = await env.app.inject({
    method: 'GET',
    url: '/auth/admin/me',
    headers: { cookie: env.cookies.larry },
  });
  assert.equal(oldSession.statusCode, 401);

  const [entry] = await env.mintStore.listAudit();
  assert.equal(entry.action, 'admin.recovered');
  assert.equal(entry.payload.removedKeys, 1);
  assert.equal(entry.payload.requestedBy, 'legal@eqowa.com');

  // The new invite enrols a new key and restores access.
  const fresh = await env.enrolFrom(body.inviteUrl);
  const me = await env.app.inject({ method: 'GET', url: '/auth/admin/me', headers: { cookie: fresh } });
  assert.equal(me.json().admin.email, 'larry@eqowa.com');
  assert.equal(me.json().admin.status, 'active');
});

test('nobody approves their own reset or their own request, and only operations approves', async () => {
  const env = await setup();
  const forLarry = await openTicket(env, 'ops2', 'larry');
  const selfApprove = await post(
    env,
    `/admin/recovery/${forLarry}/approve`,
    { safeTxHash: SAFE_TX },
    { cookie: env.cookies.larry },
  );
  assert.equal(selfApprove.statusCode, 403);
  assert.equal(selfApprove.json().reason, 'self_approval');

  const ownRequest = await post(
    env,
    `/admin/recovery/${forLarry}/approve`,
    { safeTxHash: SAFE_TX },
    { cookie: env.cookies.ops2 },
  );
  assert.equal(ownRequest.json().reason, 'requester_approval');

  const compliance = await post(
    env,
    `/admin/recovery/${forLarry}/approve`,
    { safeTxHash: SAFE_TX },
    { cookie: env.cookies.legal },
  );
  assert.equal(compliance.statusCode, 403);
  assert.equal(compliance.json().reason, 'forbidden');

  // The legacy key, kept until handover, is a third party here.
  const legacy = await post(
    env,
    `/admin/recovery/${forLarry}/approve`,
    { safeTxHash: SAFE_TX },
    {
      'x-admin-key': 'legacy-key',
      'x-admin-actor': 'larry-shell',
    },
  );
  assert.equal(legacy.statusCode, 200);
});

test('a Safe hash is required, one ticket per admin, and a closed ticket cannot be approved twice', async () => {
  const env = await setup();
  const ticketId = await openTicket(env, 'legal', 'larry');
  const duplicate = await post(
    env,
    '/admin/recovery',
    { adminId: env.ids.larry, reason: 'again' },
    { cookie: env.cookies.legal },
  );
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().reason, 'ticket_open');

  const noHash = await post(
    env,
    `/admin/recovery/${ticketId}/approve`,
    { safeTxHash: '0x1234' },
    { cookie: env.cookies.ops2 },
  );
  assert.equal(noHash.json().reason, 'invalid_safe_tx');

  await post(env, `/admin/recovery/${ticketId}/approve`, { safeTxHash: SAFE_TX }, { cookie: env.cookies.ops2 });
  const again = await post(
    env,
    `/admin/recovery/${ticketId}/approve`,
    { safeTxHash: SAFE_TX },
    { cookie: env.cookies.ops2 },
  );
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().reason, 'already_resolved');
});

test('a ticket can be rejected with a reason, and lists show who asked and who decided', async () => {
  const env = await setup();
  const ticketId = await openTicket(env, 'legal', 'larry');
  const noReason = await post(env, `/admin/recovery/${ticketId}/reject`, {}, { cookie: env.cookies.ops2 });
  assert.equal(noReason.json().reason, 'reason_required');

  const rejected = await post(
    env,
    `/admin/recovery/${ticketId}/reject`,
    { reason: 'Larry found his key' },
    { cookie: env.cookies.ops2 },
  );
  assert.equal(rejected.json().ticket.status, 'rejected');
  // Nothing was reset.
  assert.equal((await env.adminStore.listCredentials(env.ids.larry)).length, 1);

  const list = (
    await env.app.inject({ method: 'GET', url: '/admin/recovery', headers: { cookie: env.cookies.legal } })
  ).json();
  assert.equal(list.tickets[0].admin.email, 'larry@eqowa.com');
  assert.equal(list.tickets[0].requestedBy, 'legal@eqowa.com');
  assert.equal(list.tickets[0].resolvedBy, 'ops2@eqowa.com');
  assert.equal((await env.mintStore.listAudit())[0].action, 'admin.recovery_rejected');
});
