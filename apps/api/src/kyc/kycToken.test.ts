import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { TERMS_VERSION } from '../../../../config/terms.ts';

import { MemoryConsentStore } from '../auth/consentStore.ts';
import type { AuthConfig } from '../auth/routes.ts';
import { signSession } from '../auth/session.ts';
import { buildApp } from '../index.ts';

import { MemoryIdentityStore } from './identityStore.ts';
import { SumsubError, createSumsubAccessToken } from './sumsubClient.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const NOW = new Date('2026-09-30T10:00:00.000Z');
const ENV = {
  SUMSUB_APP_TOKEN: 'sbx:app-token',
  SUMSUB_SECRET_KEY: 'secret-key',
  SUMSUB_BASE_URL: 'https://api.sumsub.test',
};
const AUTH: AuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_session',
  secureCookie: true,
  siweDomain: 'app.eqowa.com',
  chainId: 80002,
};

test('createSumsubAccessToken signs the request the way Sumsub checks it', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Response.json({ token: '_act-sbx-abc', userId: WALLET });
  }) as unknown as typeof fetch;

  const issued = await createSumsubAccessToken({ userId: WALLET }, ENV, { fetch: fakeFetch, now: () => NOW });

  assert.deepEqual(issued, { token: '_act-sbx-abc', userId: WALLET, levelName: 'id-and-liveness' });
  const [{ url, init }] = seen;
  assert.equal(url, 'https://api.sumsub.test/resources/accessTokens/sdk');
  assert.equal(init.method, 'POST');
  const body = String(init.body);
  assert.deepEqual(JSON.parse(body), { userId: WALLET, levelName: 'id-and-liveness', ttlInSecs: 1800 });

  const headers = init.headers as Record<string, string>;
  const ts = String(NOW.getTime() / 1000);
  assert.equal(headers['X-App-Token'], 'sbx:app-token');
  assert.equal(headers['X-App-Access-Ts'], ts);
  // Independent recomputation of Sumsub's rule: HMAC(ts + METHOD + path + body).
  const expected = createHmac('sha256', 'secret-key')
    .update(`${ts}POST/resources/accessTokens/sdk${body}`)
    .digest('hex');
  assert.equal(headers['X-App-Access-Sig'], expected);
});

test('createSumsubAccessToken uses the configured level, is off without keys and throws on errors', async () => {
  let level = '';
  const ok = (async (_url: string, init: RequestInit) => {
    level = JSON.parse(String(init.body)).levelName;
    return Response.json({ token: 't' });
  }) as unknown as typeof fetch;
  await createSumsubAccessToken({ userId: WALLET }, { ...ENV, SUMSUB_LEVEL_NAME: 'id-only' }, { fetch: ok });
  assert.equal(level, 'id-only');

  assert.equal(await createSumsubAccessToken({ userId: WALLET }, {}), null);

  const failing = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(createSumsubAccessToken({ userId: WALLET }, ENV, { fetch: failing }), SumsubError);
  const empty = (async () => Response.json({})) as unknown as typeof fetch;
  await assert.rejects(createSumsubAccessToken({ userId: WALLET }, ENV, { fetch: empty }), /no access token/);
});

/** A consent store in which WALLET has accepted the current terms. */
async function acceptedConsents(wallet = WALLET) {
  const consents = new MemoryConsentStore();
  await consents.record({
    walletAddress: wallet,
    termsVersion: TERMS_VERSION,
    message: 'm',
    signature: '0x',
    acceptedAt: NOW,
  });
  return consents;
}

function cookie() {
  const token = signSession(
    { kind: 'investor', walletAddress: WALLET, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) },
    AUTH.secret,
  );
  return `eqowa_session=${token}`;
}

async function requestToken(options: {
  identities?: MemoryIdentityStore;
  createKycToken?: (userId: string) => Promise<{ token: string; levelName: string } | null>;
  signedIn?: boolean;
  consents?: MemoryConsentStore;
}) {
  const app = buildApp({
    auth: AUTH,
    identityStore: options.identities ?? new MemoryIdentityStore(),
    createKycToken: options.createKycToken,
    consents: options.consents ?? (await acceptedConsents()),
    now: () => NOW,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/investor/kyc/token',
    headers: options.signedIn === false ? {} : { cookie: cookie() },
  });
  await app.close();
  return response;
}

test('issues a token bound to the signed-in wallet only', async () => {
  const asked: string[] = [];
  const response = await requestToken({
    createKycToken: async (userId) => {
      asked.push(userId);
      return { token: '_act-1', levelName: 'id-and-liveness' };
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), { ok: true, token: '_act-1', levelName: 'id-and-liveness' });
  assert.deepEqual(asked, [WALLET]);
});

test('refuses an already approved investor, and maps missing keys and provider failures', async () => {
  const identities = new MemoryIdentityStore();
  await identities.recordKyc({
    walletAddress: WALLET,
    onchainIdAddress: '0x2222222222222222222222222222222222222222',
    countryCode: 566,
    kycStatus: 'approved',
    applicantId: 'app-1',
    claims: [1, 2],
  });
  const approved = await requestToken({ identities, createKycToken: async () => ({ token: 'x', levelName: 'l' }) });
  assert.equal(approved.statusCode, 409);
  assert.equal(approved.json().reason, 'kyc_already_approved');

  const noKeys = await requestToken({ createKycToken: async () => null });
  assert.equal(noKeys.statusCode, 503);
  assert.equal(noKeys.json().reason, 'kyc_unavailable');

  const down = await requestToken({
    createKycToken: async () => {
      throw new SumsubError(500, 'boom');
    },
  });
  assert.equal(down.statusCode, 502);
  assert.equal(down.json().reason, 'kyc_provider_error');

  assert.equal((await requestToken({ signedIn: false })).statusCode, 401);
});

test('refuses to start KYC before the terms are accepted', async () => {
  const response = await requestToken({
    consents: new MemoryConsentStore(),
    createKycToken: async () => ({ token: 'x', levelName: 'id-and-liveness' }),
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().reason, 'terms_not_accepted');
});
