import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, type TransactionRequest } from 'ethers';

import {
  CHECKOUT_USDT_ABI,
  COMPLIANCE_ABI,
  FORWARDER_ABI,
  IDENTITY_REGISTRY_ABI,
  TOKEN_HOLDER_VIEW_ABI,
} from '../../../../config/abis.ts';
import type { CheckoutResponse } from '../../../../config/api.ts';
import { ONE_SHARE, ONE_USDT } from '../../../../config/eqowa.ts';

import type { ChainReader } from '../assets/catalog.ts';
import type { AuthConfig } from '../auth/routes.ts';
import { signSession } from '../auth/session.ts';
import { buildApp } from '../index.ts';
import { MemoryIdentityStore } from '../kyc/identityStore.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333';
const ESCROW = '0x4444444444444444444444444444444444444444';
const FORWARDER = '0x5555555555555555555555555555555555555555';
const REGISTRY = '0x6666666666666666666666666666666666666666';
const COMPLIANCE = '0x7777777777777777777777777777777777777777';
const ZERO = '0x0000000000000000000000000000000000000000';
const NOW = new Date('2026-09-30T09:00:00.000Z');
const AUTH: AuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_session',
  secureCookie: true,
  siweDomain: 'app.eqowa.com',
  chainId: 80002,
};
const CONTRACTS = { token: TOKEN, usdt: USDT, escrow: ESCROW, forwarder: FORWARDER };

type Contracts = Record<string, { abi: string[]; values: Record<string, unknown[]> }>;

function contracts(overrides: { verified?: boolean; compliant?: boolean; balance?: bigint; allowance?: bigint } = {}) {
  return {
    [TOKEN]: { abi: TOKEN_HOLDER_VIEW_ABI, values: { identityRegistry: [REGISTRY], compliance: [COMPLIANCE] } },
    [USDT]: {
      abi: CHECKOUT_USDT_ABI,
      values: {
        name: ['Mock USDT'],
        balanceOf: [overrides.balance ?? 100n * ONE_USDT],
        allowance: [overrides.allowance ?? 0n],
        getNonce: [2n],
      },
    },
    [FORWARDER]: { abi: FORWARDER_ABI, values: { getNonce: [5n] } },
    [REGISTRY]: { abi: IDENTITY_REGISTRY_ABI, values: { isVerified: [overrides.verified ?? true] } },
    [COMPLIANCE]: { abi: COMPLIANCE_ABI, values: { canTransfer: [overrides.compliant ?? true] } },
  } satisfies Contracts;
}

function fakeChain(map: Contracts) {
  const calls: { to: string; fn: string; args: unknown[] }[] = [];
  const chain: ChainReader & { calls: typeof calls } = {
    provider: null,
    calls,
    getBlockNumber: async () => 900,
    async call(tx: TransactionRequest) {
      const to = String(tx.to).toLowerCase();
      const entry = Object.entries(map).find(([address]) => address.toLowerCase() === to)?.[1];
      if (!entry) {
        throw new Error(`no contract at ${to}`);
      }
      const iface = new Interface(entry.abi);
      const fragment = iface.getFunction(String(tx.data).slice(0, 10))!;
      calls.push({ to, fn: fragment.name, args: [...iface.decodeFunctionData(fragment, String(tx.data))] });
      const value = entry.values[fragment.name];
      if (!value) {
        throw new Error(`execution reverted: ${fragment.name}`);
      }
      return iface.encodeFunctionResult(fragment, value);
    },
  };
  return chain;
}

async function approvedIdentities(status: 'approved' | 'pending' = 'approved') {
  const identities = new MemoryIdentityStore();
  await identities.recordKyc({
    walletAddress: WALLET,
    onchainIdAddress: '0x8888888888888888888888888888888888888888',
    countryCode: 566,
    kycStatus: status,
    applicantId: 'app-1',
    claims: [1, 2],
  });
  return identities;
}

function cookie() {
  const token = signSession(
    { kind: 'investor', walletAddress: WALLET, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) },
    AUTH.secret,
  );
  return `eqowa_session=${token}`;
}

async function checkout(options: {
  chain: ChainReader;
  identities?: MemoryIdentityStore;
  usdtAmount?: string;
  withContracts?: boolean;
}) {
  const app = buildApp({
    auth: AUTH,
    chain: options.chain,
    chainId: 80002,
    identityStore: options.identities ?? (await approvedIdentities()),
    checkoutContracts: options.withContracts === false ? undefined : CONTRACTS,
    now: () => NOW,
  });
  const response = await app.inject({
    method: 'GET',
    url: `/investor/checkout?usdtAmount=${options.usdtAmount ?? String(12n * ONE_USDT)}`,
    headers: { cookie: cookie() },
  });
  await app.close();
  return response;
}

test('a verified, compliant investor with funds has no blockers', async () => {
  const chain = fakeChain(contracts());
  const response = await checkout({ chain });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), {
    ok: true,
    walletAddress: WALLET,
    chainId: 80002,
    blockNumber: 900,
    usdtAmount: (12n * ONE_USDT).toString(),
    shares: '2',
    shareAmount: (2n * ONE_SHARE).toString(),
    fundsAmount: (8n * ONE_USDT).toString(),
    feeAmount: (2n * ONE_USDT).toString(),
    remainderAmount: (2n * ONE_USDT).toString(),
    kycStatus: 'approved',
    identityVerified: true,
    compliant: true,
    usdtBalance: (100n * ONE_USDT).toString(),
    allowance: '0',
    needsApproval: true,
    blockers: [],
    contracts: { usdt: USDT, escrow: ESCROW, forwarder: FORWARDER },
    usdtName: 'Mock USDT',
    usdtMetaNonce: '2',
    forwarderNonce: '5',
  } satisfies CheckoutResponse);

  // Compliance is asked exactly what mint will ask: from the zero address, the share amount.
  const canTransfer = chain.calls.find((call) => call.fn === 'canTransfer')!;
  assert.deepEqual(canTransfer.args.map(String), [ZERO, WALLET, (2n * ONE_SHARE).toString()]);
});

test('reports every blocker at once', async () => {
  const response = await checkout({
    chain: fakeChain(contracts({ verified: false, balance: ONE_USDT })),
    identities: await approvedIdentities('pending'),
  });
  assert.deepEqual(response.json().blockers, ['kyc_not_approved', 'identity_not_verified', 'insufficient_usdt']);
});

test('flags a compliance refusal and an amount below one share', async () => {
  const refused = await checkout({ chain: fakeChain(contracts({ compliant: false })) });
  assert.deepEqual(refused.json().blockers, ['not_compliant']);

  const chain = fakeChain(contracts());
  const tooSmall = await checkout({ chain, usdtAmount: String(4n * ONE_USDT) });
  assert.deepEqual(tooSmall.json().blockers, ['below_share_price']);
  // Zero shares is not a mint, so compliance is not asked.
  assert.equal(
    chain.calls.some((call) => call.fn === 'canTransfer'),
    false,
  );
});

test('skips the approval once the allowance covers the amount', async () => {
  const response = await checkout({ chain: fakeChain(contracts({ allowance: 12n * ONE_USDT })) });
  assert.equal(response.json().needsApproval, false);
});

test('rejects bad amounts and answers 503 when checkout is not configured or the chain fails', async () => {
  for (const usdtAmount of ['0', 'abc', '-5', '1.5', '9'.repeat(21)]) {
    const response = await checkout({ chain: fakeChain(contracts()), usdtAmount });
    assert.equal(response.statusCode, 400, usdtAmount);
    assert.equal(response.json().reason, 'invalid_amount');
  }

  const off = await checkout({ chain: fakeChain(contracts()), withContracts: false });
  assert.equal(off.json().reason, 'checkout_unavailable');

  const broken = contracts();
  delete (broken[USDT].values as Record<string, unknown>).balanceOf;
  const down = await checkout({ chain: fakeChain(broken) });
  assert.equal(down.statusCode, 503);
  assert.equal(down.json().reason, 'chain_unavailable');
});

test('needs a signed-in investor', async () => {
  const app = buildApp({ auth: AUTH, chain: fakeChain(contracts()), checkoutContracts: CONTRACTS, now: () => NOW });
  const response = await app.inject({ method: 'GET', url: '/investor/checkout?usdtAmount=5000000' });
  assert.equal(response.statusCode, 401);
  await app.close();
});
