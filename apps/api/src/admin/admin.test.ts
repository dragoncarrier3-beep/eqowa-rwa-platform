import assert from 'node:assert/strict';
import test from 'node:test';

import { applyExceptionResolution } from '../../../../config/exceptions.ts';
import { ONE_USDT } from '../../../../config/eqowa.ts';

import { buildApp } from '../index.ts';
import { MemoryIdentityStore } from '../kyc/identityStore.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';
import { createMintQuote, recordMintDeposit, settleMintQuote } from '../mint/pipeline.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const ADMIN = 'test-admin-key';
const SEVEN_USDT = (7n * ONE_USDT).toString();
const START = new Date('2026-09-16T12:00:00.000Z');

function approvedIdentities() {
  const identities = new MemoryIdentityStore();
  return identities
    .recordKyc({
      walletAddress: WALLET,
      onchainIdAddress: '0x3333333333333333333333333333333333333333',
      countryCode: 566,
      kycStatus: 'approved',
      applicantId: 'app-1',
      claims: [1, 2],
    })
    .then(() => identities);
}

test('applyExceptionResolution refuses a second close', () => {
  const open = {
    id: 'ex-1',
    kind: 'remainder',
    intentId: 'intent-1',
    status: 'open' as const,
    details: {},
    createdAt: START,
  };
  const first = applyExceptionResolution(open, { actor: 'ops', resolution: 'refunded leftover', now: START });
  assert.equal('record' in first, true);
  if ('record' in first) {
    const second = applyExceptionResolution(first.record, {
      actor: 'ops',
      resolution: 'try again',
      now: START,
    });
    assert.deepEqual(second, { error: 'already_resolved' });
  }
  assert.deepEqual(applyExceptionResolution(open, { actor: 'ops', resolution: '  ', now: START }), {
    error: 'empty_resolution',
  });
});

test('admin can list and resolve an open remainder exception', async () => {
  const mintStore = new MemoryMintStore();
  const identities = await approvedIdentities();
  const quoted = await createMintQuote({
    input: { wallet: WALLET, usdtAmount: SEVEN_USDT },
    store: mintStore,
    now: START,
  });
  if ('error' in quoted) {
    throw new Error(quoted.error);
  }

  await recordMintDeposit({
    input: {
      intentId: quoted.quote.intentId,
      payerAddress: WALLET,
      tokenAddress: TOKEN,
      amount: SEVEN_USDT,
      txHash: '0xabc',
      blockNumber: 100,
    },
    store: mintStore,
    now: START,
  });
  await settleMintQuote({
    intentId: quoted.quote.intentId,
    store: mintStore,
    identities,
    now: START,
    currentBlock: 112,
  });

  const app = buildApp({ mintStore, identityStore: identities, adminKey: ADMIN, now: () => START });
  const listed = await app.inject({
    method: 'GET',
    url: '/admin/exceptions?status=open',
    headers: { 'x-admin-key': ADMIN },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().exceptions.length, 1);
  assert.equal(listed.json().exceptions[0].kind, 'remainder');

  const id = listed.json().exceptions[0].id as string;
  const resolved = await app.inject({
    method: 'POST',
    url: `/admin/exceptions/${id}/resolve`,
    headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN, 'x-admin-actor': 'larry' },
    payload: JSON.stringify({ resolution: 'refunded 2 USDT leftover' }),
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().exception.status, 'resolved');
  assert.equal(resolved.json().exception.resolvedBy, 'larry');

  const again = await app.inject({
    method: 'POST',
    url: `/admin/exceptions/${id}/resolve`,
    headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
    payload: JSON.stringify({ resolution: 'again' }),
  });
  assert.equal(again.statusCode, 409);

  const audit = await app.inject({
    method: 'GET',
    url: '/admin/audit',
    headers: { 'x-admin-key': ADMIN },
  });
  const actions = audit.json().audit.map((row: { action: string }) => row.action);
  assert.equal(actions.includes('exception.opened'), true);
  assert.equal(actions.includes('exception.resolved'), true);
  await app.close();
});

test('admin routes reject a missing or wrong key', async () => {
  const app = buildApp({ adminKey: ADMIN });
  const missing = await app.inject({ method: 'GET', url: '/admin/exceptions' });
  assert.equal(missing.statusCode, 401);

  const wrong = await app.inject({
    method: 'GET',
    url: '/admin/audit',
    headers: { 'x-admin-key': 'nope' },
  });
  assert.equal(wrong.statusCode, 401);

  const unconfigured = buildApp();
  const disabled = await unconfigured.inject({
    method: 'GET',
    url: '/admin/exceptions',
    headers: { 'x-admin-key': ADMIN },
  });
  assert.equal(disabled.statusCode, 503);
  await app.close();
  await unconfigured.close();
});
