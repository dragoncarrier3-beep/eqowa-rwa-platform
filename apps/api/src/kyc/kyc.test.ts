import assert from 'node:assert/strict';
import test from 'node:test';

import { ALLOWED_COUNTRIES } from '../../../../config/countries.ts';
import { CLAIM_TOPIC_KYC, CLAIM_TOPIC_RESIDENCY, COUNTRY } from '../../../../config/eqowa.ts';
import { mockOnchainId } from '../../../../config/claims.ts';
import { decideKyc } from '../../../../config/kyc.ts';
import { ISO_COUNTRIES, parseCountryCode } from '../../../../config/iso3166.ts';

import { buildApp } from '../index.ts';
import { applySumsubWebhook } from './applyKyc.ts';
import { MemoryIdentityStore } from './identityStore.ts';
import { sumsubHmacHex } from './sumsubSignature.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const SECRET = 'sumsub-webhook-secret';

function reviewedPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'applicantReviewed',
    applicantId: 'app-1',
    externalUserId: WALLET,
    reviewResult: { reviewAnswer: 'GREEN' },
    info: { country: 'NGA' },
    ...overrides,
  };
}

test('ISO map covers the allow-list and the blocked United States', () => {
  const numerics = new Set(ISO_COUNTRIES.map((row) => row.numeric));
  for (const code of ALLOWED_COUNTRIES) {
    assert.equal(numerics.has(code), true, `missing ISO row for ${code}`);
  }
  assert.equal(parseCountryCode('NG'), COUNTRY.NIGERIA);
  assert.equal(parseCountryCode('NGA'), COUNTRY.NIGERIA);
  assert.equal(parseCountryCode('566'), COUNTRY.NIGERIA);
  assert.equal(parseCountryCode('US'), COUNTRY.UNITED_STATES);
  assert.equal(parseCountryCode('XX'), null);
});

test('GREEN allow-listed country issues claims 1 and 2', () => {
  const decision = decideKyc('GREEN', parseCountryCode('NG'));
  assert.deepEqual(decision, { action: 'issue', countryCode: COUNTRY.NIGERIA });
});

test('GREEN United States is blocked and RED does not issue', () => {
  assert.deepEqual(decideKyc('GREEN', parseCountryCode('US')), { action: 'reject', reason: 'blocked_country' });
  assert.deepEqual(decideKyc('RED', parseCountryCode('NG')), { action: 'reject', reason: 'review_red' });
});

test('applySumsubWebhook records a mock ONCHAINID for a GREEN review', async () => {
  const store = new MemoryIdentityStore();
  const result = await applySumsubWebhook({ payload: reviewedPayload(), store });

  assert.equal(result.status, 'approved');
  assert.deepEqual(result.identity?.claims, [Number(CLAIM_TOPIC_KYC), Number(CLAIM_TOPIC_RESIDENCY)]);
  assert.equal(result.identity?.onchainIdAddress, mockOnchainId(WALLET));
  assert.equal(result.identity?.countryCode, COUNTRY.NIGERIA);
});

test('applySumsubWebhook can take country from the applicant lookup', async () => {
  const store = new MemoryIdentityStore();
  const result = await applySumsubWebhook({
    payload: {
      type: 'applicantReviewed',
      applicantId: 'app-2',
      externalUserId: WALLET,
      reviewResult: { reviewAnswer: 'GREEN' },
    },
    store,
    lookupApplicant: async () => ({ country: 'GB' }),
  });

  assert.equal(result.status, 'approved');
  assert.equal(result.identity?.countryCode, COUNTRY.UNITED_KINGDOM);
});

test('POST /webhooks/sumsub verifies HMAC and is idempotent', async () => {
  const store = new MemoryIdentityStore();
  const app = buildApp({ webhookSecret: SECRET, identityStore: store });
  const body = JSON.stringify(reviewedPayload());
  const digest = sumsubHmacHex(body, SECRET);
  const headers = {
    'content-type': 'application/json',
    'x-payload-digest': digest,
    'x-payload-digest-alg': 'HMAC_SHA256_HEX',
  };

  const first = await app.inject({ method: 'POST', url: '/webhooks/sumsub', headers, payload: body });
  const second = await app.inject({ method: 'POST', url: '/webhooks/sumsub', headers, payload: body });

  assert.equal(first.statusCode, 200);
  assert.equal(first.json().status, 'approved');
  assert.equal(second.statusCode, 200);
  assert.equal(store.records.length, 1);
  await app.close();
});

test('POST /webhooks/sumsub rejects a bad digest when a secret is set', async () => {
  const app = buildApp({ webhookSecret: SECRET, identityStore: new MemoryIdentityStore() });
  const body = JSON.stringify(reviewedPayload());
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: {
      'content-type': 'application/json',
      'x-payload-digest': '00'.repeat(32),
      'x-payload-digest-alg': 'HMAC_SHA256_HEX',
    },
    payload: body,
  });

  assert.equal(response.statusCode, 401);
  await app.close();
});

test('POST /webhooks/sumsub ignores applicantPending', async () => {
  const app = buildApp({ webhookSecret: '', identityStore: new MemoryIdentityStore() });
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ type: 'applicantPending', applicantId: 'app-3' }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ignored');
  await app.close();
});

test('every verified webhook delivery is stored, including ignored types', async () => {
  const store = new MemoryIdentityStore();
  const app = buildApp({ webhookSecret: '', identityStore: store });

  await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ type: 'applicantPending', applicantId: 'app-1' }),
  });
  await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(reviewedPayload()),
  });

  const events = await store.listEvents('app-1');
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, 'applicantPending');
  assert.equal(events[0].status, 'ignored');
  assert.equal(events[1].eventType, 'applicantReviewed');
  assert.equal(events[1].status, 'approved');
  assert.equal(events[1].reviewAnswer, 'GREEN');
  assert.equal(events[1].countryCode, COUNTRY.NIGERIA);
  await app.close();
});

test('a rejected signature is not stored as a delivery', async () => {
  const store = new MemoryIdentityStore();
  const app = buildApp({ webhookSecret: SECRET, identityStore: store });
  await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: { 'content-type': 'application/json', 'x-payload-digest': '00'.repeat(32) },
    payload: JSON.stringify(reviewedPayload()),
  });
  assert.equal(store.events.length, 0);
  await app.close();
});

test('GET /admin/kyc/:applicantId shows the identity and its deliveries', async () => {
  const store = new MemoryIdentityStore();
  const app = buildApp({ webhookSecret: '', identityStore: store, adminKey: 'k' });
  await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(reviewedPayload({ info: { country: 'USA' } })),
  });

  const response = await app.inject({ method: 'GET', url: '/admin/kyc/app-1', headers: { 'x-admin-key': 'k' } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.identity.kycStatus, 'blocked_country');
  assert.equal(body.identity.countryCode, COUNTRY.UNITED_STATES);
  assert.deepEqual(body.identity.claims, []);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].status, 'rejected');
  assert.equal(body.events[0].reason, 'blocked_country');

  const missing = await app.inject({ method: 'GET', url: '/admin/kyc/nobody', headers: { 'x-admin-key': 'k' } });
  assert.equal(missing.statusCode, 404);

  const denied = await app.inject({ method: 'GET', url: '/admin/kyc/app-1', headers: { 'x-admin-key': 'wrong' } });
  assert.equal(denied.statusCode, 401);
  await app.close();
});

test('GET /admin/kyc lists identities and filters by status', async () => {
  const store = new MemoryIdentityStore();
  const app = buildApp({ webhookSecret: '', identityStore: store, adminKey: 'k' });
  await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(reviewedPayload()),
  });
  await app.inject({
    method: 'POST',
    url: '/webhooks/sumsub',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(
      reviewedPayload({
        applicantId: 'app-2',
        externalUserId: '0x2222222222222222222222222222222222222222',
        reviewResult: { reviewAnswer: 'RED' },
      }),
    ),
  });

  const all = await app.inject({ method: 'GET', url: '/admin/kyc', headers: { 'x-admin-key': 'k' } });
  assert.equal(all.json().identities.length, 2);

  const approved = await app.inject({
    method: 'GET',
    url: '/admin/kyc?status=approved',
    headers: { 'x-admin-key': 'k' },
  });
  assert.equal(approved.json().identities.length, 1);
  assert.equal(approved.json().identities[0].applicantId, 'app-1');
  assert.deepEqual(approved.json().identities[0].claims, [1, 2]);

  const unconfigured = buildApp({ webhookSecret: '', identityStore: store, adminKey: '' });
  const off = await unconfigured.inject({ method: 'GET', url: '/admin/kyc', headers: { 'x-admin-key': 'k' } });
  assert.equal(off.statusCode, 503);
  await unconfigured.close();
  await app.close();
});
