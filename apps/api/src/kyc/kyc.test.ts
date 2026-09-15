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
  const app = buildApp({ identityStore: new MemoryIdentityStore() });
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
