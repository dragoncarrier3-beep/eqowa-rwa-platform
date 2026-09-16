import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeEscrowDeposit } from '../../../../config/forwarder.ts';
import { ONE_USDT } from '../../../../config/eqowa.ts';

import { buildApp } from '../index.ts';
import { parseForwardRequest } from './relayDeposit.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const ESCROW = '0x2222222222222222222222222222222222222222';
const INTENT = '0x' + 'ab'.repeat(32);

test('parseForwardRequest reads string uints', () => {
  const parsed = parseForwardRequest({
    from: WALLET,
    to: ESCROW,
    value: '0',
    gas: '500000',
    nonce: '1',
    data: encodeEscrowDeposit(INTENT, 5n * ONE_USDT),
  });
  assert.ok(parsed);
  assert.equal(parsed?.gas, 500000n);
  assert.equal(parsed?.nonce, 1n);
});

test('POST /relayer/deposit is unavailable until a relayer is wired', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/relayer/deposit',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      request: { from: WALLET, to: ESCROW, value: '0', gas: '1', nonce: '0', data: '0x' },
      signature: '0x',
    }),
  });
  assert.equal(response.statusCode, 503);
  await app.close();
});

test('POST /relayer/deposit submits a verified forward request', async () => {
  const app = buildApp({
    relayDeposit: async ({ request, signature }) => {
      assert.equal(request.from, WALLET);
      assert.equal(signature, '0xsig');
      return { txHash: '0xhash', intentId: INTENT, amount: 5n * ONE_USDT };
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/relayer/deposit',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      request: {
        from: WALLET,
        to: ESCROW,
        value: 0,
        gas: 500000,
        nonce: 0,
        data: encodeEscrowDeposit(INTENT, 5n * ONE_USDT),
      },
      signature: '0xsig',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().txHash, '0xhash');
  assert.equal(response.json().amount, (5n * ONE_USDT).toString());
  await app.close();
});
