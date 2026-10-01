import assert from 'node:assert/strict';
import test from 'node:test';

import { AbiCoder, Interface, type TransactionRequest } from 'ethers';

import {
  BALANCE_CAP_ABI,
  DAILY_MINT_CAP_ABI,
  HOLDER_COUNT_CAP_ABI,
  TIME_LOCKUP_ABI,
  TOKEN_VIEW_ABI,
} from '../../../../config/abis.ts';
import type { AdminComplianceResponse } from '../../../../config/api.ts';
import { ONE_SHARE } from '../../../../config/eqowa.ts';

import type { ChainReader } from '../assets/catalog.ts';
import type { AdminAuthConfig } from '../auth/adminAuth.ts';
import { MemoryAdminStore } from '../auth/adminStore.ts';
import { signAdminSession } from '../auth/session.ts';
import { buildApp } from '../index.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';

import type { TokenActions } from './tokenRoutes.ts';

const NOW = new Date('2026-09-30T11:00:00.000Z');
const TOKEN = '0x2222222222222222222222222222222222222222';
const COMPLIANCE = '0x3333333333333333333333333333333333333333';
const BALANCE = '0x4444444444444444444444444444444444444444';
const HOLDERS = '0x5555555555555555555555555555555555555555';
const DAILY = '0x6666666666666666666666666666666666666666';
const LOCKUP = '0x7777777777777777777777777777777777777777';
const COUNTRIES = '0x8888888888888888888888888888888888888888';
const SAFE = '0x9999999999999999999999999999999999999999';
const WALLET = '0x1111111111111111111111111111111111111111';
const ADMIN_AUTH: AdminAuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_admin',
  secureCookie: true,
  rpID: 'app.eqowa.com',
  rpName: 'EQOWA Admin',
  origin: 'https://app.eqowa.com',
};

const CONTRACTS: Record<string, { abi: string[]; values: Record<string, unknown[]> }> = {
  [TOKEN]: { abi: TOKEN_VIEW_ABI, values: { compliance: [COMPLIANCE], paused: [false] } },
  [BALANCE]: { abi: BALANCE_CAP_ABI, values: { getMaxBalance: [150_000n * ONE_SHARE] } },
  [HOLDERS]: { abi: HOLDER_COUNT_CAP_ABI, values: { getMaxHolderCount: [500n], getHolderCount: [12n] } },
  [DAILY]: {
    abi: DAILY_MINT_CAP_ABI,
    values: { getDailyMintCap: [250_000n * ONE_SHARE], getRemainingAllowance: [249_000n * ONE_SHARE] },
  },
  [LOCKUP]: { abi: TIME_LOCKUP_ABI, values: { getLockupDuration: [730n * 86_400n] } },
  [COUNTRIES]: {
    abi: ['function isCountryAllowed(address _compliance, uint16 _country) view returns (bool)'],
    values: {},
  },
};

const chain: ChainReader = {
  provider: null,
  getBlockNumber: async () => 900,
  async call(tx: TransactionRequest) {
    const entry = Object.entries(CONTRACTS).find(
      ([address]) => address.toLowerCase() === String(tx.to).toLowerCase(),
    )?.[1];
    if (!entry) {
      throw new Error('no contract');
    }
    const iface = new Interface(entry.abi);
    const fragment = iface.getFunction(String(tx.data).slice(0, 10))!;
    if (fragment.name === 'isCountryAllowed') {
      const [, country] = iface.decodeFunctionData(fragment, String(tx.data));
      // Nigeria allowed, United States not.
      return iface.encodeFunctionResult(fragment, [Number(country) === 566]);
    }
    return iface.encodeFunctionResult(fragment, entry.values[fragment.name]);
  },
} as unknown as ChainReader;

async function setup(tokenActions?: TokenActions) {
  const adminStore = new MemoryAdminStore();
  const mintStore = new MemoryMintStore();
  const cookies: Record<string, string> = {};
  for (const role of ['ceo', 'compliance', 'operations'] as const) {
    const admin = await adminStore.createAdmin({ email: `${role}@eqowa.com`, name: role, role, now: NOW });
    await adminStore.setStatus(admin.id, 'active');
    cookies[role] = `eqowa_admin=${signAdminSession(
      { kind: 'admin', adminId: admin.id, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000) },
      ADMIN_AUTH.secret,
    )}`;
  }
  const app = buildApp({
    adminAuth: ADMIN_AUTH,
    adminStore,
    mintStore,
    chain,
    chainId: 80002,
    tokenAddress: TOKEN,
    complianceModules: {
      balanceCap: BALANCE,
      holderCountCap: HOLDERS,
      dailyMintCap: DAILY,
      timeLockup: LOCKUP,
      countryAllowlist: COUNTRIES,
    },
    safeAddress: SAFE,
    tokenActions,
    now: () => NOW,
  });
  return { app, cookies, mintStore };
}

function fakeActions(overrides: Partial<TokenActions> = {}) {
  const calls: string[] = [];
  const actions: TokenActions = {
    setPaused: async (paused) => {
      calls.push(`paused:${paused}`);
      return { changed: true, txHash: '0xpause' };
    },
    mint: async (wallet, amount) => {
      calls.push(`mint:${wallet}:${amount}`);
      return '0xmint';
    },
    burn: async (wallet, amount) => {
      calls.push(`burn:${wallet}:${amount}`);
      return '0xburn';
    },
    ...overrides,
  };
  return { actions, calls };
}

test('only operations may pause, mint and burn, always with a reason that is audited', async () => {
  const { actions, calls } = fakeActions();
  const env = await setup(actions);
  const post = (url: string, cookie: string, payload: unknown) =>
    env.app.inject({ method: 'POST', url, payload, headers: { cookie } });

  assert.equal((await post('/admin/token/pause', env.cookies.compliance, { reason: 'x' })).statusCode, 403);
  assert.equal(
    (await post('/admin/token/mint', env.cookies.ceo, { wallet: WALLET, shares: '1', reason: 'x' })).statusCode,
    403,
  );
  assert.equal((await post('/admin/token/pause', env.cookies.operations, {})).json().reason, 'reason_required');

  const paused = await post('/admin/token/pause', env.cookies.operations, { reason: 'Incident review' });
  assert.deepEqual(paused.json(), { ok: true, changed: true, txHash: '0xpause' });

  const minted = await post('/admin/token/mint', env.cookies.operations, {
    wallet: WALLET,
    shares: '25',
    reason: 'Allocation per board minute 7',
  });
  assert.equal(minted.statusCode, 200);
  assert.equal(minted.json().txHash, '0xmint');
  const burnt = await post('/admin/token/burn', env.cookies.operations, {
    wallet: WALLET,
    shares: 5,
    reason: 'Redemption',
  });
  assert.equal(burnt.json().txHash, '0xburn');

  assert.deepEqual(calls, ['paused:true', `mint:${WALLET}:${25n * ONE_SHARE}`, `burn:${WALLET}:${5n * ONE_SHARE}`]);
  const [latest] = await env.mintStore.listAudit();
  assert.equal(latest.action, 'token.burned');
  assert.equal(latest.actor, 'operations@eqowa.com');
  assert.deepEqual(latest.payload, {
    wallet: WALLET,
    shares: '5',
    reason: 'Redemption',
    changed: true,
    txHash: '0xburn',
  });

  for (const shares of ['0', '-1', '1.5', 'abc', '99999999999']) {
    const bad = await post('/admin/token/mint', env.cookies.operations, { wallet: WALLET, shares, reason: 'x' });
    assert.equal(bad.json().reason, 'invalid_amount', shares);
  }
  assert.equal(
    (await post('/admin/token/mint', env.cookies.operations, { wallet: 'nope', shares: '1', reason: 'x' })).json()
      .reason,
    'invalid_address',
  );
});

test('a refusal by the chain comes back in plain words and is not audited', async () => {
  const revert = Object.assign(new Error('execution reverted'), {
    data: `0x08c379a0${AbiCoder.defaultAbiCoder().encode(['string'], ['Identity is not verified.']).slice(2)}`,
  });
  const { actions } = fakeActions({
    mint: async () => {
      throw revert;
    },
  });
  const env = await setup(actions);
  const response = await env.app.inject({
    method: 'POST',
    url: '/admin/token/mint',
    payload: { wallet: WALLET, shares: '1', reason: 'x' },
    headers: { cookie: env.cookies.operations },
  });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().reason, 'chain_error');
  assert.match(response.json().detail, /no verified identity/);
  assert.deepEqual(await env.mintStore.listAudit(), []);

  const off = await setup();
  const unavailable = await off.app.inject({
    method: 'POST',
    url: '/admin/token/unpause',
    payload: { reason: 'x' },
    headers: { cookie: off.cookies.operations },
  });
  assert.equal(unavailable.statusCode, 503);
});

test('every admin role can read the live rules', async () => {
  const env = await setup();
  const response = await env.app.inject({
    method: 'GET',
    url: '/admin/compliance',
    headers: { cookie: env.cookies.ceo },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    blockNumber: 900,
    compliance: COMPLIANCE,
    safe: SAFE,
    paused: false,
    rules: {
      maxBalanceShares: '150000',
      maxHolderCount: '500',
      holderCount: '12',
      dailyMintCapShares: '250000',
      remainingMintShares: '249000',
      lockupDays: '730',
    },
    countryModule: COUNTRIES,
  } satisfies AdminComplianceResponse);

  const countries = await env.app.inject({
    method: 'GET',
    url: '/admin/compliance/countries?codes=566,840',
    headers: { cookie: env.cookies.compliance },
  });
  assert.deepEqual(countries.json().countries, [
    { code: 566, allowed: true },
    { code: 840, allowed: false },
  ]);
});

test('operations prepares a rule change as a Safe batch file; others cannot', async () => {
  const env = await setup();
  const prepare = (cookie: string, payload: unknown) =>
    env.app.inject({ method: 'POST', url: '/admin/compliance/prepare', payload, headers: { cookie } });

  assert.equal((await prepare(env.cookies.compliance, { kind: 'maxBalance', value: '200000' })).statusCode, 403);
  assert.equal(
    (await prepare(env.cookies.operations, { kind: 'maxBalance', value: '0' })).json().reason,
    'invalid_change',
  );
  assert.equal(
    (await prepare(env.cookies.operations, { kind: 'lockupDays', value: '5000' })).json().reason,
    'invalid_change',
  );
  assert.equal((await prepare(env.cookies.operations, { kind: 'nonsense' })).statusCode, 400);

  const response = await prepare(env.cookies.operations, { kind: 'allowCountries', countries: [840, 124] });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.description, 'Allow countries 840, 124');
  assert.equal(body.file.chainId, '80002');
  assert.equal(body.file.meta.createdFromSafeAddress, SAFE);
  assert.equal(body.file.transactions[0].to, COMPLIANCE);
  const [entry] = await env.mintStore.listAudit();
  assert.equal(entry.action, 'compliance.prepared');
});
