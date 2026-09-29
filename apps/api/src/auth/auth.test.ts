import assert from 'node:assert/strict';
import test from 'node:test';

import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

import type { InvestorMeResponse } from '../../../../config/api.ts';
import { ONE_SHARE } from '../../../../config/eqowa.ts';
import { TERMS_VERSION, consentStatement } from '../../../../config/terms.ts';

import { createAuthConfigFromEnv } from '../bootstrap.ts';
import { buildApp } from '../index.ts';
import { MemoryTokenLedger } from '../indexer/ledger.ts';
import { MemoryIdentityStore } from '../kyc/identityStore.ts';

import { MemoryConsentStore } from './consentStore.ts';
import { MemoryNonceStore } from './nonceStore.ts';
import type { AuthConfig } from './routes.ts';
import { parseCookies, serializeCookie, signSession, verifySession } from './session.ts';

// Hardhat's well-known first test key. Never funded outside a local chain.
const INVESTOR = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const OTHER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TOKEN = '0x2222222222222222222222222222222222222222';
const SECRET = 'test-secret-that-is-at-least-32-characters';
const NOW = new Date('2026-09-29T10:00:00.000Z');

const AUTH: AuthConfig = {
  secret: SECRET,
  cookieName: 'eqowa_session',
  secureCookie: true,
  siweDomain: 'app.eqowa.com',
  chainId: 80002,
};

function setup() {
  let at = NOW.getTime();
  const identities = new MemoryIdentityStore();
  const ledger = new MemoryTokenLedger();
  const nonces = new MemoryNonceStore();
  const consents = new MemoryConsentStore();
  const app = buildApp({
    auth: AUTH,
    nonces,
    consents,
    identityStore: identities,
    ledger,
    tokenAddress: TOKEN,
    now: () => new Date(at),
  });
  return {
    app,
    identities,
    ledger,
    consents,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

async function nonceFrom(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({ method: 'GET', url: '/auth/siwe/nonce' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  return response.json().nonce as string;
}

function message(nonce: string, overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    address: INVESTOR.address,
    chainId: 80002,
    domain: 'app.eqowa.com',
    uri: 'https://app.eqowa.com',
    version: '1',
    nonce,
    issuedAt: NOW,
    expirationTime: new Date(NOW.getTime() + 10 * 60 * 1000),
    statement: consentStatement(),
    ...overrides,
  });
}

async function signIn(app: ReturnType<typeof buildApp>, text: string, signer = INVESTOR) {
  const signature = await signer.signMessage({ message: text });
  return app.inject({ method: 'POST', url: '/auth/siwe/verify', payload: { message: text, signature } });
}

function sessionCookie(setCookie: string | string[] | undefined) {
  const header = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '');
  return header.split(';')[0];
}

test('a signed SIWE message starts a 7 day HttpOnly session', async () => {
  const { app } = setup();
  const response = await signIn(app, message(await nonceFrom(app)));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().session, {
    kind: 'investor',
    walletAddress: INVESTOR.address,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const setCookie = String(response.headers['set-cookie']);
  assert.match(setCookie, /^eqowa_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Max-Age=604800/);

  const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: sessionCookie(setCookie) } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().session.walletAddress, INVESTOR.address);
  await app.close();
});

test('a nonce signs in only once', async () => {
  const { app } = setup();
  const text = message(await nonceFrom(app));
  assert.equal((await signIn(app, text)).statusCode, 200);

  const replay = await signIn(app, text);
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().reason, 'invalid_nonce');
  await app.close();
});

test('refuses a nonce the API never issued or one that expired', async () => {
  const { app, advance } = setup();
  const invented = await signIn(app, message('abcdefgh12345678'));
  assert.equal(invented.json().reason, 'invalid_nonce');

  const nonce = await nonceFrom(app);
  advance(11 * 60 * 1000);
  const late = await signIn(
    app,
    message(nonce, {
      issuedAt: new Date(NOW.getTime() + 11 * 60 * 1000),
      expirationTime: new Date(NOW.getTime() + 20 * 60 * 1000),
    }),
  );
  assert.equal(late.json().reason, 'invalid_nonce');
  await app.close();
});

test('refuses another domain, another chain, an expired message and a wrong signer', async () => {
  const { app, advance } = setup();

  const phishing = await signIn(
    app,
    message(await nonceFrom(app), { domain: 'eqowa-login.com', uri: 'https://eqowa-login.com' }),
  );
  assert.equal(phishing.json().reason, 'wrong_domain');

  const uriMismatch = await signIn(app, message(await nonceFrom(app), { uri: 'https://evil.example' }));
  assert.equal(uriMismatch.json().reason, 'wrong_domain');

  const mainnet = await signIn(app, message(await nonceFrom(app), { chainId: 137 }));
  assert.equal(mainnet.json().reason, 'wrong_chain');

  // The message names INVESTOR but OTHER signs it.
  const impostor = await signIn(app, message(await nonceFrom(app)), OTHER);
  assert.equal(impostor.statusCode, 401);
  assert.equal(impostor.json().reason, 'invalid_signature');

  const nonce = await nonceFrom(app);
  advance(10 * 60 * 1000 + 1);
  const expired = await signIn(app, message(nonce));
  assert.equal(expired.json().reason, 'message_expired');

  const garbage = await app.inject({
    method: 'POST',
    url: '/auth/siwe/verify',
    payload: { message: 'hello', signature: '0x00' },
  });
  assert.equal(garbage.statusCode, 401);
  assert.equal(garbage.json().reason, 'invalid_message');
  await app.close();
});

test('a failed sign-in does not spend the nonce', async () => {
  const { app } = setup();
  const nonce = await nonceFrom(app);
  assert.equal((await signIn(app, message(nonce), OTHER)).json().reason, 'invalid_signature');
  assert.equal((await signIn(app, message(nonce))).statusCode, 200);
  await app.close();
});

test('/auth/me refuses a missing, forged or expired session and logout clears the cookie', async () => {
  const { app, advance } = setup();
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me' })).statusCode, 401);

  const forged = signSession(
    { kind: 'investor', walletAddress: INVESTOR.address, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) },
    'another-secret-that-is-at-least-32-chars',
  );
  const withForged = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { cookie: `eqowa_session=${forged}` },
  });
  assert.equal(withForged.statusCode, 401);

  const cookie = sessionCookie((await signIn(app, message(await nonceFrom(app)))).headers['set-cookie']);
  advance(7 * 24 * 60 * 60 * 1000);
  const expired = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
  assert.equal(expired.statusCode, 401);

  const logout = await app.inject({ method: 'POST', url: '/auth/logout' });
  assert.match(String(logout.headers['set-cookie']), /^eqowa_session=; .*Max-Age=0/);
  await app.close();
});

test('/investor/me returns KYC status and indexed holding for the signed-in wallet only', async () => {
  const { app, identities, ledger } = setup();
  await identities.recordKyc({
    walletAddress: INVESTOR.address.toLowerCase(),
    onchainIdAddress: '0x3333333333333333333333333333333333333333',
    countryCode: 566,
    kycStatus: 'approved',
    applicantId: 'app-1',
    claims: [1, 2],
  });
  await ledger.applyEvent(TOKEN, {
    eventName: 'Transfer',
    txHash: '0xaa',
    logIndex: 0,
    blockNumber: 42,
    fromAddress: '0x0000000000000000000000000000000000000000',
    toAddress: INVESTOR.address,
    amount: 25n * ONE_SHARE,
    frozen: null,
  });

  assert.equal((await app.inject({ method: 'GET', url: '/investor/me' })).statusCode, 401);

  const cookie = sessionCookie((await signIn(app, message(await nonceFrom(app)))).headers['set-cookie']);
  const me = await app.inject({ method: 'GET', url: '/investor/me', headers: { cookie } });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), {
    ok: true,
    walletAddress: INVESTOR.address,
    termsAccepted: true,
    termsVersion: TERMS_VERSION,
    kyc: {
      status: 'approved',
      countryCode: 566,
      onchainIdAddress: '0x3333333333333333333333333333333333333333',
      // Approved by Sumsub, not yet registered on-chain by the onboarding worker.
      registration: 'pending',
    },
    holding: { balance: (25n * ONE_SHARE).toString(), frozen: false, updatedBlock: 42 },
  } satisfies InvestorMeResponse);
  await app.close();
});

test('auth routes answer 503 when sign-in is not configured', async () => {
  const app = buildApp({});
  for (const [method, url] of [
    ['GET', '/auth/siwe/nonce'],
    ['POST', '/auth/siwe/verify'],
    ['GET', '/auth/me'],
    ['POST', '/auth/logout'],
    ['GET', '/investor/me'],
  ] as const) {
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 503, url);
    assert.equal(response.json().reason, 'auth_unconfigured');
  }
  await app.close();
});

test('session tokens and cookies round-trip', () => {
  const session = {
    kind: 'investor' as const,
    walletAddress: INVESTOR.address,
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 1000),
  };
  const token = signSession(session, SECRET);
  assert.deepEqual(verifySession(token, SECRET, NOW), session);
  assert.equal(verifySession(`${token}x`, SECRET, NOW), null);
  assert.equal(verifySession(token, SECRET, new Date(NOW.getTime() + 1000)), null);

  assert.deepEqual(parseCookies('a=1; eqowa_session=abc.def; b=x%20y'), { a: '1', eqowa_session: 'abc.def', b: 'x y' });
  assert.equal(
    serializeCookie('s', 'v', { maxAgeSeconds: 5, secure: false }),
    's=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=5',
  );
});

test('createAuthConfigFromEnv needs a long secret and the web host', () => {
  assert.deepEqual(createAuthConfigFromEnv({ AUTH_SECRET: 'short', SIWE_DOMAIN: 'app.eqowa.com' }), {
    disabled: 'set AUTH_SECRET to at least 32 random characters',
  });
  assert.deepEqual(createAuthConfigFromEnv({ AUTH_SECRET: SECRET }), {
    disabled: 'set SIWE_DOMAIN to the web app host',
  });
  assert.deepEqual(
    createAuthConfigFromEnv({
      AUTH_SECRET: SECRET,
      SIWE_DOMAIN: 'localhost:3000',
      CHAIN_ID: '31337',
      AUTH_COOKIE_SECURE: 'false',
    }),
    {
      auth: {
        secret: SECRET,
        cookieName: 'eqowa_session',
        secureCookie: false,
        siweDomain: 'localhost:3000',
        chainId: 31337,
      },
    },
  );
});

test('signing the consent sentence records the acceptance as evidence', async () => {
  const { app, consents } = setup();
  const text = message(await nonceFrom(app));
  const signature = await INVESTOR.signMessage({ message: text });
  const response = await app.inject({
    method: 'POST',
    url: '/auth/siwe/verify',
    payload: { message: text, signature },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(consents.records, [
    {
      walletAddress: INVESTOR.address.toLowerCase(),
      termsVersion: TERMS_VERSION,
      message: text,
      signature,
      acceptedAt: NOW,
    },
  ]);
  await app.close();
});

test('a sign-in without the current consent sentence records nothing and leaves terms unaccepted', async () => {
  const { app, consents } = setup();
  const old = message(await nonceFrom(app), { statement: consentStatement('2020-old') });
  const response = await signIn(app, old);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(consents.records, []);
  const cookie = sessionCookie(response.headers['set-cookie']);
  const me = await app.inject({ method: 'GET', url: '/investor/me', headers: { cookie } });
  assert.equal(me.json().termsAccepted, false);
  await app.close();
});
