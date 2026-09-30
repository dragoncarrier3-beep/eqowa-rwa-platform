import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminAuthConfigFromEnv } from '../bootstrap.ts';
import { buildApp } from '../index.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';

import { inviteAdmin, type AdminAuthConfig } from './adminAuth.ts';
import { MemoryAdminStore } from './adminStore.ts';
import { SoftKey } from './softKey.ts';

const ORIGIN = 'https://app.eqowa.com';
const RP_ID = 'app.eqowa.com';
const NOW = new Date('2026-09-30T09:00:00.000Z');
const ADMIN_AUTH: AdminAuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_admin',
  secureCookie: true,
  rpID: RP_ID,
  rpName: 'EQOWA Admin',
  origin: ORIGIN,
};

function setup() {
  let at = NOW.getTime();
  const adminStore = new MemoryAdminStore();
  const mintStore = new MemoryMintStore();
  const app = buildApp({
    adminAuth: ADMIN_AUTH,
    adminStore,
    mintStore,
    adminKey: 'legacy-key',
    webOrigin: ORIGIN,
    now: () => new Date(at),
  });
  return {
    app,
    adminStore,
    mintStore,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

type App = ReturnType<typeof buildApp>;

function cookieOf(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header).split(';')[0];
}

async function invite(store: MemoryAdminStore, email: string, role: 'ceo' | 'operations' | 'compliance') {
  const result = await inviteAdmin({ store, email, name: email, role, createdBy: 'cli', webOrigin: ORIGIN, now: NOW });
  assert.ok('inviteUrl' in result);
  return { ...result, token: new URL(result.inviteUrl).searchParams.get('token')! };
}

async function enrol(app: App, key: SoftKey, body: { token?: string; cookie?: string; label?: string }) {
  const headers = body.cookie ? { cookie: body.cookie } : undefined;
  const optionsResponse = await app.inject({
    method: 'POST',
    url: '/auth/admin/register/options',
    payload: { token: body.token },
    headers,
  });
  assert.equal(optionsResponse.statusCode, 200, optionsResponse.body);
  const { options } = optionsResponse.json();
  return {
    options,
    verify: await app.inject({
      method: 'POST',
      url: '/auth/admin/register/verify',
      payload: { token: body.token, label: body.label, response: key.register(options, ORIGIN) },
      headers,
    }),
  };
}

async function login(app: App, key: SoftKey, email: string, tweak: { origin?: string; counter?: number } = {}) {
  const { options } = (
    await app.inject({ method: 'POST', url: '/auth/admin/login/options', payload: { email } })
  ).json();
  const response = key.sign(options, tweak.origin ?? ORIGIN, RP_ID, tweak.counter);
  return {
    options,
    response,
    verify: await app.inject({ method: 'POST', url: '/auth/admin/login/verify', payload: { email, response } }),
  };
}

/** An enrolled, active admin with one key and a live session. */
async function activeAdmin(env: ReturnType<typeof setup>, email: string, role: 'ceo' | 'operations' | 'compliance') {
  const key = new SoftKey();
  const { token } = await invite(env.adminStore, email, role);
  const { verify } = await enrol(env.app, key, { token });
  assert.equal(verify.statusCode, 200, verify.body);
  return { key, cookie: cookieOf(verify) };
}

test('an invite enrols the first key once and starts a 12 hour admin session', async () => {
  const env = setup();
  const key = new SoftKey();
  const { token, inviteUrl, admin } = await invite(env.adminStore, 'larryjacob@eqowa.com', 'operations');
  assert.match(inviteUrl, /^https:\/\/app\.eqowa\.com\/admin\/enrol\?token=/);

  const inspect = await env.app.inject({ method: 'POST', url: '/auth/admin/invite/inspect', payload: { token } });
  assert.equal(inspect.json().admin.email, 'larryjacob@eqowa.com');

  const { verify } = await enrol(env.app, key, { token, label: 'YubiKey 1' });
  assert.equal(verify.statusCode, 200, verify.body);
  assert.match(String(verify.headers['set-cookie']), /^eqowa_admin=.*HttpOnly.*SameSite=Lax.*Max-Age=43200/);
  assert.equal((await env.adminStore.getAdmin(admin.id))?.status, 'active');
  assert.equal((await env.mintStore.listAudit())[0]?.action, 'admin.credential_added');

  // The link is spent: it cannot enrol another key.
  const again = await env.app.inject({ method: 'POST', url: '/auth/admin/register/options', payload: { token } });
  assert.equal(again.statusCode, 401);
  const inspectAgain = await env.app.inject({ method: 'POST', url: '/auth/admin/invite/inspect', payload: { token } });
  assert.equal(inspectAgain.statusCode, 404);
});

test('a second key is added from the session, and the same key cannot be added twice', async () => {
  const env = setup();
  const { key, cookie } = await activeAdmin(env, 'larryjacob@eqowa.com', 'operations');

  const before = (await env.app.inject({ method: 'GET', url: '/auth/admin/me', headers: { cookie } })).json();
  assert.equal(before.needsSecondKey, true);
  assert.equal(before.credentials.length, 1);

  const second = new SoftKey();
  const { options, verify } = await enrol(env.app, second, { cookie, label: 'YubiKey 2' });
  assert.deepEqual(
    options.excludeCredentials.map((item: { id: string }) => item.id),
    [key.id],
  );
  assert.equal(verify.statusCode, 200, verify.body);

  const after = (await env.app.inject({ method: 'GET', url: '/auth/admin/me', headers: { cookie } })).json();
  assert.equal(after.needsSecondKey, false);
  assert.deepEqual(
    after.credentials.map((item: { label: string }) => item.label),
    ['Security key', 'YubiKey 2'],
  );
  assert.ok(after.permissions.includes('mint:approve'));
});

test('login with either key; a replayed assertion, a cloned key and a phishing origin are refused', async () => {
  const env = setup();
  const { key } = await activeAdmin(env, 'larryjacob@eqowa.com', 'operations');

  const first = await login(env.app, key, 'larryjacob@eqowa.com');
  assert.equal(first.verify.statusCode, 200, first.verify.body);
  assert.deepEqual(
    first.options.allowCredentials.map((item: { id: string }) => item.id),
    [key.id],
  );
  assert.equal((await env.mintStore.listAudit())[0]?.action, 'admin.login');

  // Same signed answer again: the challenge was spent.
  const replay = await env.app.inject({
    method: 'POST',
    url: '/auth/admin/login/verify',
    payload: { email: 'larryjacob@eqowa.com', response: first.response },
  });
  assert.equal(replay.statusCode, 401);

  // A copy of the key would sign with a counter that does not move forward.
  const cloned = await login(env.app, key, 'larryjacob@eqowa.com', { counter: 1 });
  assert.equal(cloned.verify.statusCode, 401);

  const phished = await login(env.app, key, 'larryjacob@eqowa.com', { origin: 'https://eqowa-login.com' });
  assert.equal(phished.verify.statusCode, 401);
  assert.equal(phished.verify.json().reason, 'invalid_login');
});

test("unknown emails look the same as real ones, and one admin's key cannot sign in another", async () => {
  const env = setup();
  const larry = await activeAdmin(env, 'larryjacob@eqowa.com', 'operations');
  await activeAdmin(env, 'legal@eqowa.com', 'compliance');

  const unknown = await env.app.inject({
    method: 'POST',
    url: '/auth/admin/login/options',
    payload: { email: 'nobody@eqowa.com' },
  });
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(unknown.json().options.allowCredentials, []);

  const crossed = await login(env.app, larry.key, 'legal@eqowa.com');
  assert.equal(crossed.verify.statusCode, 401);
});

test('roles decide what each admin may do', async () => {
  const env = setup();
  const ceo = await activeAdmin(env, 'info@eqowa.com', 'ceo');
  const compliance = await activeAdmin(env, 'legal@eqowa.com', 'compliance');
  const operations = await activeAdmin(env, 'larryjacob@eqowa.com', 'operations');

  const approve = (cookie: string) =>
    env.app.inject({
      method: 'POST',
      url: '/admin/mint/0xabc/approve',
      payload: { safeTxHash: '0x1' },
      headers: { cookie },
    });
  assert.equal((await approve(ceo.cookie)).statusCode, 403);
  assert.equal((await approve(compliance.cookie)).statusCode, 403);
  // Operations passes the guard; the quote itself does not exist.
  assert.equal((await approve(operations.cookie)).statusCode, 400);

  const audit = await env.app.inject({ method: 'GET', url: '/admin/audit', headers: { cookie: ceo.cookie } });
  assert.equal(audit.statusCode, 200);

  const inviteAs = (cookie: string) =>
    env.app.inject({
      method: 'POST',
      url: '/admin/team/invite',
      payload: { email: 'new@eqowa.com', name: 'New', role: 'compliance' },
      headers: { cookie },
    });
  const refused = await inviteAs(compliance.cookie);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().permission, 'team:manage');
  const invited = await inviteAs(operations.cookie);
  assert.equal(invited.statusCode, 200);
  assert.match(invited.json().inviteUrl, /\/admin\/enrol\?token=/);
  assert.equal((await env.mintStore.listAudit())[0]?.actor, 'larryjacob@eqowa.com');

  const team = (await env.app.inject({ method: 'GET', url: '/admin/team', headers: { cookie: ceo.cookie } })).json();
  assert.deepEqual(
    team.team.map((row: { email: string; credentialCount: number }) => [row.email, row.credentialCount]),
    [
      ['info@eqowa.com', 1],
      ['legal@eqowa.com', 1],
      ['larryjacob@eqowa.com', 1],
      ['new@eqowa.com', 0],
    ],
  );
});

test('a disabled admin is locked out at once, and the legacy key still acts as operations', async () => {
  const env = setup();
  const { cookie } = await activeAdmin(env, 'legal@eqowa.com', 'compliance');
  const admin = await env.adminStore.getAdminByEmail('legal@eqowa.com');
  await env.adminStore.setStatus(admin!.id, 'disabled');

  const locked = await env.app.inject({ method: 'GET', url: '/admin/audit', headers: { cookie } });
  assert.equal(locked.statusCode, 401);

  const legacy = await env.app.inject({
    method: 'POST',
    url: '/admin/team/invite',
    payload: { email: 'x@eqowa.com', role: 'ceo' },
    headers: { 'x-admin-key': 'legacy-key', 'x-admin-actor': 'larry' },
  });
  assert.equal(legacy.statusCode, 200);
  const wrong = await env.app.inject({ method: 'GET', url: '/admin/audit', headers: { 'x-admin-key': 'nope' } });
  assert.equal(wrong.statusCode, 401);
});

test('the last key cannot be removed; a spare one can', async () => {
  const env = setup();
  const { cookie } = await activeAdmin(env, 'larryjacob@eqowa.com', 'operations');
  const [only] = (await env.app.inject({ method: 'GET', url: '/auth/admin/me', headers: { cookie } })).json()
    .credentials;

  const last = await env.app.inject({
    method: 'DELETE',
    url: `/auth/admin/credentials/${only.id}`,
    headers: { cookie },
  });
  assert.equal(last.statusCode, 409);
  assert.equal(last.json().reason, 'last_credential');

  await enrol(env.app, new SoftKey(), { cookie });
  const removed = await env.app.inject({
    method: 'DELETE',
    url: `/auth/admin/credentials/${only.id}`,
    headers: { cookie },
  });
  assert.equal(removed.statusCode, 200);
  assert.equal((await env.mintStore.listAudit())[0]?.action, 'admin.credential_removed');
});

test('invites expire after 72 hours and an active admin cannot be re-invited', async () => {
  const env = setup();
  const { token } = await invite(env.adminStore, 'info@eqowa.com', 'ceo');
  env.advance(72 * 60 * 60 * 1000 + 1);
  const expired = await env.app.inject({ method: 'POST', url: '/auth/admin/invite/inspect', payload: { token } });
  assert.equal(expired.statusCode, 404);

  const fresh = setup();
  await activeAdmin(fresh, 'larryjacob@eqowa.com', 'operations');
  const result = await inviteAdmin({
    store: fresh.adminStore,
    email: 'larryjacob@eqowa.com',
    name: 'Larry',
    role: 'operations',
    createdBy: 'cli',
    webOrigin: ORIGIN,
    now: NOW,
  });
  assert.deepEqual(result, { error: 'admin_active' });
});

test('createAdminAuthConfigFromEnv needs a secret and the WebAuthn host', () => {
  assert.deepEqual(createAdminAuthConfigFromEnv({ AUTH_SECRET: 'short' }), {
    disabled: 'set AUTH_SECRET to at least 32 random characters',
  });
  assert.deepEqual(createAdminAuthConfigFromEnv({ AUTH_SECRET: ADMIN_AUTH.secret }), {
    disabled: 'set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN to the web app host and origin',
  });
  assert.deepEqual(
    createAdminAuthConfigFromEnv({
      AUTH_SECRET: ADMIN_AUTH.secret,
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: 'http://localhost:3000',
      AUTH_COOKIE_SECURE: 'false',
    }),
    {
      adminAuth: {
        secret: ADMIN_AUTH.secret,
        cookieName: 'eqowa_admin',
        secureCookie: false,
        rpID: 'localhost',
        rpName: 'EQOWA Admin',
        origin: 'http://localhost:3000',
      },
    },
  );
});
