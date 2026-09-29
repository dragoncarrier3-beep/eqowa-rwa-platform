import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayRefused, type RelayApprovalInput } from '../../../../config/relayer.ts';

import type { AuthConfig } from '../auth/routes.ts';
import { signSession } from '../auth/session.ts';
import { buildApp } from '../index.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const ESCROW = '0x2222222222222222222222222222222222222222';
const NOW = new Date('2026-09-29T12:00:00.000Z');
const AUTH: AuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_session',
  secureCookie: true,
  siweDomain: 'app.eqowa.com',
  chainId: 80002,
};
const BODY = { from: WALLET, functionSignature: '0x095ea7b3', signature: '0xsig' };

function cookie() {
  const token = signSession(
    { kind: 'investor', walletAddress: WALLET, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) },
    AUTH.secret,
  );
  return `eqowa_session=${token}`;
}

function appWith(
  relayApproval?: (input: RelayApprovalInput & { expectedFrom: string }) => Promise<{
    txHash: string;
    spender: string;
    amount: bigint;
  }>,
) {
  return buildApp({ auth: AUTH, relayApproval, now: () => NOW });
}

test('relays the signed approval for the signed-in wallet', async () => {
  const calls: Array<RelayApprovalInput & { expectedFrom: string }> = [];
  const app = appWith(async (input) => {
    calls.push(input);
    return { txHash: '0xapprove', spender: ESCROW, amount: 10_000_000n };
  });

  const response = await app.inject({
    method: 'POST',
    url: '/relayer/approve',
    payload: BODY,
    headers: { cookie: cookie() },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, txHash: '0xapprove', spender: ESCROW, amount: '10000000' });
  // The session wallet is passed down, so the relay refuses anyone else's approval.
  assert.deepEqual(calls, [{ ...BODY, expectedFrom: WALLET }]);
  await app.close();
});

test('needs a session, a relayer and a complete body', async () => {
  const app = appWith(async () => ({ txHash: '0x', spender: ESCROW, amount: 1n }));
  assert.equal((await app.inject({ method: 'POST', url: '/relayer/approve', payload: BODY })).statusCode, 401);
  const partial = await app.inject({
    method: 'POST',
    url: '/relayer/approve',
    payload: { from: WALLET },
    headers: { cookie: cookie() },
  });
  assert.equal(partial.json().reason, 'invalid_approval');
  await app.close();

  const noRelayer = appWith();
  const off = await noRelayer.inject({
    method: 'POST',
    url: '/relayer/approve',
    payload: BODY,
    headers: { cookie: cookie() },
  });
  assert.equal(off.statusCode, 503);
  assert.equal(off.json().reason, 'relayer_unavailable');
  await noRelayer.close();
});

test('maps refusals to 400 or 403 and chain failures to 502', async () => {
  for (const [error, status, reason] of [
    [new RelayRefused('not_escrow_approval', 'x'), 400, 'not_escrow_approval'],
    [new RelayRefused('invalid_signature', 'x'), 400, 'invalid_signature'],
    [new RelayRefused('domain_mismatch', 'x'), 400, 'domain_mismatch'],
    [new RelayRefused('wrong_wallet', 'x'), 403, 'wrong_wallet'],
    [new Error('nonce too low'), 502, 'relay_failed'],
  ] as const) {
    const app = appWith(async () => {
      throw error;
    });
    const response = await app.inject({
      method: 'POST',
      url: '/relayer/approve',
      payload: BODY,
      headers: { cookie: cookie() },
    });
    assert.equal(response.statusCode, status, reason);
    assert.equal(response.json().reason, reason);
    await app.close();
  }
});
