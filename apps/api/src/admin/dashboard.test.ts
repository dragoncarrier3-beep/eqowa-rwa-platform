import assert from 'node:assert/strict';
import test from 'node:test';

import type { AdminDashboardResponse, AdminInvestorDto, AdminQuoteDto } from '../../../../config/api.ts';
import { ONE_SHARE, ONE_USDT } from '../../../../config/eqowa.ts';
import type { ControlResult } from '../../../../config/tokenControls.ts';

import type { ChainReader } from '../assets/catalog.ts';
import type { AdminAuthConfig } from '../auth/adminAuth.ts';
import { MemoryAdminStore } from '../auth/adminStore.ts';
import { signAdminSession } from '../auth/session.ts';
import { buildApp } from '../index.ts';
import { MemoryTokenLedger } from '../indexer/ledger.ts';
import { TOKEN_TRANSFERS_CURSOR } from '../indexer/tokenWorker.ts';
import { MemoryIdentityStore } from '../kyc/identityStore.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';
import { createMintQuote, recordMintDeposit } from '../mint/pipeline.ts';
import { MemorySyncStateStore } from '../settlement/syncState.ts';

const NOW = new Date('2026-09-30T10:00:00.000Z');
const TOKEN = '0x2222222222222222222222222222222222222222';
const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x3333333333333333333333333333333333333333';
const CAROL = '0x4444444444444444444444444444444444444444';
const ZERO = '0x0000000000000000000000000000000000000000';
const ADMIN_AUTH: AdminAuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_admin',
  secureCookie: true,
  rpID: 'app.eqowa.com',
  rpName: 'EQOWA Admin',
  origin: 'https://app.eqowa.com',
};

async function setup(options: { setWalletFrozen?: (wallet: string, frozen: boolean) => Promise<ControlResult> } = {}) {
  const adminStore = new MemoryAdminStore();
  const mintStore = new MemoryMintStore();
  const identities = new MemoryIdentityStore();
  const ledger = new MemoryTokenLedger();
  const syncStore = new MemorySyncStateStore();
  const chain = { provider: null, getBlockNumber: async () => 520 } as unknown as ChainReader;

  const cookies: Record<string, string> = {};
  for (const [email, role] of [
    ['info@eqowa.com', 'ceo'],
    ['legal@eqowa.com', 'compliance'],
    ['larryjacob@eqowa.com', 'operations'],
  ] as const) {
    const admin = await adminStore.createAdmin({ email, name: email, role, now: NOW });
    await adminStore.setStatus(admin.id, 'active');
    const token = signAdminSession(
      { kind: 'admin', adminId: admin.id, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000) },
      ADMIN_AUTH.secret,
    );
    cookies[role] = `eqowa_admin=${token}`;
  }

  const app = buildApp({
    adminAuth: ADMIN_AUTH,
    adminStore,
    mintStore,
    identityStore: identities,
    ledger,
    syncStore,
    tokenAddress: TOKEN,
    chain,
    setWalletFrozen: options.setWalletFrozen,
    now: () => NOW,
  });
  return { app, cookies, mintStore, identities, ledger, syncStore };
}

async function mint(ledger: MemoryTokenLedger, to: string, shares: bigint, hash: string) {
  await ledger.applyEvent(TOKEN, {
    eventName: 'Transfer',
    txHash: hash,
    logIndex: 0,
    blockNumber: 100,
    fromAddress: ZERO,
    toAddress: to,
    amount: shares * ONE_SHARE,
    frozen: null,
  });
}

async function seed(env: Awaited<ReturnType<typeof setup>>) {
  const base = { onchainIdAddress: '0x9999999999999999999999999999999999999999', claims: [1, 2] };
  await env.identities.recordKyc({
    ...base,
    walletAddress: ALICE,
    countryCode: 566,
    kycStatus: 'approved',
    applicantId: 'a',
  });
  await env.identities.updateOnchain(ALICE, {
    status: 'registered',
    identityAddress: base.onchainIdAddress,
    error: null,
    attempts: 1,
  });
  await env.identities.recordKyc({
    ...base,
    walletAddress: BOB,
    countryCode: 288,
    kycStatus: 'approved',
    applicantId: 'b',
  });
  await env.identities.updateOnchain(BOB, { status: 'failed', identityAddress: null, error: 'rpc down', attempts: 5 });
  await env.identities.recordKyc({
    ...base,
    walletAddress: CAROL,
    countryCode: 840,
    kycStatus: 'blocked_country',
    applicantId: 'c',
    claims: [],
  });

  await mint(env.ledger, ALICE, 30n, '0xa1');
  // A holder with no KYC record, such as a direct test mint.
  await mint(env.ledger, '0x5555555555555555555555555555555555555555', 5n, '0xa2');
  await env.syncStore.setCursor(TOKEN_TRANSFERS_CURSOR, 508);

  const first = await createMintQuote({
    input: { wallet: ALICE, usdtAmount: (10n * ONE_USDT).toString() },
    store: env.mintStore,
    now: NOW,
  });
  const second = await createMintQuote({
    input: { wallet: BOB, usdtAmount: (5n * ONE_USDT).toString() },
    store: env.mintStore,
    now: NOW,
  });
  assert.ok('quote' in first && 'quote' in second);
  await recordMintDeposit({
    input: {
      intentId: first.quote.intentId,
      payerAddress: ALICE,
      tokenAddress: '0x6666666666666666666666666666666666666666',
      amount: (10n * ONE_USDT).toString(),
      txHash: '0xdep',
      blockNumber: 515,
    },
    store: env.mintStore,
    now: NOW,
  });
  await env.mintStore.addException({ kind: 'remainder', intentId: first.quote.intentId, details: {} });
  return { first: first.quote, second: second.quote };
}

test('the overview counts purchases, exceptions, KYC, registration and holders', async () => {
  const env = await setup();
  await seed(env);
  const response = await env.app.inject({
    method: 'GET',
    url: '/admin/dashboard',
    headers: { cookie: env.cookies.ceo },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as AdminDashboardResponse;
  assert.equal(body.quotes.total, 2);
  assert.equal(body.quotes.byStatus.deposited, 1);
  assert.equal(body.quotes.byStatus.quoted, 1);
  assert.equal(body.openExceptions, 1);
  assert.equal(body.awaitingSafeApproval, 0);
  assert.deepEqual(body.kyc, {
    total: 3,
    approved: 2,
    pending: 0,
    rejected: 0,
    blockedCountry: 1,
    registered: 1,
    registrationFailed: 1,
  });
  assert.deepEqual(body.holders, {
    holderWallets: 2,
    frozenWallets: 0,
    totalSupply: (35n * ONE_SHARE).toString(),
    indexedBlock: 508,
  });
});

test('the purchase list shows every wallet newest first, with confirmations and a status filter', async () => {
  const env = await setup();
  const { first, second } = await seed(env);

  const all = (
    await env.app.inject({ method: 'GET', url: '/admin/quotes', headers: { cookie: env.cookies.compliance } })
  ).json();
  assert.equal(all.currentBlock, 520);
  assert.deepEqual(
    all.quotes.map((quote: AdminQuoteDto) => [quote.intentId, quote.wallet]),
    [
      [second.intentId, BOB],
      [first.intentId, ALICE],
    ],
  );
  assert.deepEqual(all.quotes[1].confirmations, { current: 5, required: 12 });

  const deposited = await env.app.inject({
    method: 'GET',
    url: '/admin/quotes?status=deposited',
    headers: { cookie: env.cookies.ceo },
  });
  assert.deepEqual(
    deposited.json().quotes.map((quote: AdminQuoteDto) => quote.intentId),
    [first.intentId],
  );
  const bad = await env.app.inject({
    method: 'GET',
    url: '/admin/quotes?status=nonsense',
    headers: { cookie: env.cookies.ceo },
  });
  assert.equal(bad.statusCode, 400);
});

test('the investor list joins KYC, registration and holdings, largest holding first', async () => {
  const env = await setup();
  await seed(env);
  const response = await env.app.inject({
    method: 'GET',
    url: '/admin/investors',
    headers: { cookie: env.cookies.ceo },
  });
  const investors = response.json().investors as AdminInvestorDto[];
  assert.deepEqual(
    investors.map((row) => [row.walletAddress, row.kycStatus, row.registration, row.balance]),
    [
      [ALICE, 'approved', 'registered', (30n * ONE_SHARE).toString()],
      ['0x5555555555555555555555555555555555555555', null, null, (5n * ONE_SHARE).toString()],
      [BOB, 'approved', 'failed', '0'],
      [CAROL, 'blocked_country', 'pending', '0'],
    ],
  );
  assert.equal(investors[2].registrationError, 'rpc down');
});

test('compliance and operations freeze with a reason that lands in the audit log; the CEO cannot', async () => {
  const calls: Array<[string, boolean]> = [];
  const env = await setup({
    setWalletFrozen: async (wallet, frozen) => {
      calls.push([wallet, frozen]);
      return { changed: true, txHash: '0xfreeze' };
    },
  });
  const freeze = (cookie: string, payload: unknown, wallet = ALICE, action = 'freeze') =>
    env.app.inject({ method: 'POST', url: `/admin/investors/${wallet}/${action}`, payload, headers: { cookie } });

  const refused = await freeze(env.cookies.ceo, { reason: 'test' });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().permission, 'investors:freeze');

  assert.equal((await freeze(env.cookies.compliance, {})).json().reason, 'reason_required');
  assert.equal((await freeze(env.cookies.compliance, { reason: 'x' }, 'not-a-wallet')).statusCode, 400);

  const done = await freeze(env.cookies.compliance, { reason: 'Court order 2026/114' });
  assert.equal(done.statusCode, 200);
  assert.deepEqual(done.json(), { ok: true, changed: true, txHash: '0xfreeze' });
  const [entry] = await env.mintStore.listAudit();
  assert.equal(entry.actor, 'legal@eqowa.com');
  assert.equal(entry.action, 'investor.frozen');
  assert.deepEqual(entry.payload, { wallet: ALICE, reason: 'Court order 2026/114', changed: true, txHash: '0xfreeze' });

  const lifted = await freeze(env.cookies.operations, { reason: 'Order lifted' }, ALICE, 'unfreeze');
  assert.equal(lifted.statusCode, 200);
  assert.deepEqual(calls, [
    [ALICE, true],
    [ALICE, false],
  ]);
  assert.equal((await env.mintStore.listAudit())[0].action, 'investor.unfrozen');
});

test('freeze answers 503 without token controls and 502 when the transaction fails', async () => {
  const off = await setup();
  const unavailable = await off.app.inject({
    method: 'POST',
    url: `/admin/investors/${ALICE}/freeze`,
    payload: { reason: 'x' },
    headers: { cookie: off.cookies.operations },
  });
  assert.equal(unavailable.statusCode, 503);

  const failing = await setup({
    setWalletFrozen: async () => {
      throw new Error('execution reverted');
    },
  });
  const failed = await failing.app.inject({
    method: 'POST',
    url: `/admin/investors/${ALICE}/freeze`,
    payload: { reason: 'x' },
    headers: { cookie: failing.cookies.operations },
  });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().reason, 'chain_error');
  // Nothing happened on-chain, so nothing is claimed in the audit log.
  assert.deepEqual(await failing.mintStore.listAudit(), []);
});
