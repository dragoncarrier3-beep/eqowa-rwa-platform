import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, type TransactionRequest } from 'ethers';

import { IDENTITY_REGISTRY_VIEW_ABI, TIME_LOCKUP_ABI, TOKEN_HOLDER_VIEW_ABI } from '../../../../config/abis.ts';
import type { InvestorQuoteDto, PortfolioResponse } from '../../../../config/api.ts';
import { ONE_SHARE, ONE_USDT } from '../../../../config/eqowa.ts';

import type { ChainReader } from '../assets/catalog.ts';
import type { AuthConfig } from '../auth/routes.ts';
import { signSession } from '../auth/session.ts';
import { buildApp } from '../index.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';
import { createMintQuote, recordMintDeposit } from '../mint/pipeline.ts';

import { toInvestorQuote } from './quotes.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER_WALLET = '0x9999999999999999999999999999999999999999';
const TOKEN = '0x2222222222222222222222222222222222222222';
const REGISTRY = '0x3333333333333333333333333333333333333333';
const COMPLIANCE = '0x4444444444444444444444444444444444444444';
const LOCKUP = '0x5555555555555555555555555555555555555555';
const IDENTITY = '0x6666666666666666666666666666666666666666';
const ZERO = '0x0000000000000000000000000000000000000000';
const NOW = new Date('2026-09-29T12:00:00.000Z');
const RELEASE_1 = Date.parse('2028-09-01T00:00:00.000Z') / 1000;
const RELEASE_2 = Date.parse('2028-09-20T00:00:00.000Z') / 1000;

const AUTH: AuthConfig = {
  secret: 'test-secret-that-is-at-least-32-characters',
  cookieName: 'eqowa_session',
  secureCookie: true,
  siweDomain: 'app.eqowa.com',
  chainId: 80002,
};

type Contracts = Record<string, { abi: string[]; values: Record<string, unknown[]> }>;

function contracts(identity = IDENTITY): Contracts {
  return {
    [TOKEN]: {
      abi: TOKEN_HOLDER_VIEW_ABI,
      values: {
        balanceOf: [30n * ONE_SHARE],
        isFrozen: [false],
        getFrozenTokens: [2n * ONE_SHARE],
        identityRegistry: [REGISTRY],
        compliance: [COMPLIANCE],
      },
    },
    [REGISTRY]: { abi: IDENTITY_REGISTRY_VIEW_ABI, values: { identity: [identity] } },
    [LOCKUP]: {
      abi: TIME_LOCKUP_ABI,
      values: {
        getLockedAmount: [30n * ONE_SHARE],
        getSpendableAmount: [0n],
        getLockupDuration: [730n * 86_400n],
        getLockedTranches: [
          [10n * ONE_SHARE, 20n * ONE_SHARE],
          [BigInt(RELEASE_1), BigInt(RELEASE_2)],
        ],
      },
    },
  };
}

function fakeChain(map: Contracts, blockNumber = 500) {
  const calls: { to: string; fn: string; args: unknown[] }[] = [];
  const chain: ChainReader & { calls: typeof calls; head: number } = {
    provider: null,
    calls,
    head: blockNumber,
    async getBlockNumber() {
      return chain.head;
    },
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

function cookieFor(wallet: string) {
  const token = signSession(
    { kind: 'investor', walletAddress: wallet, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000) },
    AUTH.secret,
  );
  return `${AUTH.cookieName}=${token}`;
}

function appWith(options: { chain?: ChainReader; lockupModule?: string; mintStore?: MemoryMintStore } = {}) {
  return buildApp({
    auth: AUTH,
    chain: options.chain,
    chainId: 80002,
    tokenAddress: TOKEN,
    lockupModule: options.lockupModule,
    mintStore: options.mintStore,
    now: () => NOW,
  });
}

test('portfolio reads balance, freezes and the exact lock-up tranches at one block', async () => {
  const chain = fakeChain(contracts());
  const app = appWith({ chain, lockupModule: LOCKUP });

  const response = await app.inject({
    method: 'GET',
    url: '/investor/portfolio',
    headers: { cookie: cookieFor(WALLET) },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    walletAddress: WALLET,
    tokenAddress: TOKEN,
    chainId: 80002,
    blockNumber: 500,
    readAt: NOW.toISOString(),
    balance: (30n * ONE_SHARE).toString(),
    frozen: false,
    frozenTokens: (2n * ONE_SHARE).toString(),
    identityAddress: IDENTITY,
    lockup: {
      locked: (30n * ONE_SHARE).toString(),
      spendable: '0',
      lockupDays: 730,
      tranches: [
        { amount: (10n * ONE_SHARE).toString(), releaseAt: '2028-09-01T00:00:00.000Z' },
        { amount: (20n * ONE_SHARE).toString(), releaseAt: '2028-09-20T00:00:00.000Z' },
      ],
    },
  } satisfies PortfolioResponse);

  // Lock-up is asked about the identity under the token's compliance, never the wallet.
  const lockupCalls = chain.calls.filter((call) => call.to === LOCKUP.toLowerCase() && call.fn !== 'getLockupDuration');
  assert.equal(lockupCalls.length, 3);
  for (const call of lockupCalls) {
    assert.equal(String(call.args[0]).toLowerCase(), COMPLIANCE.toLowerCase());
    assert.equal(String(call.args[1]).toLowerCase(), IDENTITY.toLowerCase());
  }
  await app.close();
});

test('portfolio leaves lock-up null without an identity or a configured module', async () => {
  const noIdentity = appWith({ chain: fakeChain(contracts(ZERO)), lockupModule: LOCKUP });
  const first = (
    await noIdentity.inject({ method: 'GET', url: '/investor/portfolio', headers: { cookie: cookieFor(WALLET) } })
  ).json();
  assert.equal(first.identityAddress, null);
  assert.equal(first.lockup, null);
  await noIdentity.close();

  const noModule = appWith({ chain: fakeChain(contracts()) });
  const second = (
    await noModule.inject({ method: 'GET', url: '/investor/portfolio', headers: { cookie: cookieFor(WALLET) } })
  ).json();
  assert.equal(second.identityAddress, IDENTITY);
  assert.equal(second.lockup, null);
  await noModule.close();
});

test('portfolio needs a session and answers 503 when the chain cannot be read', async () => {
  const map = contracts();
  const app = appWith({ chain: fakeChain(map), lockupModule: LOCKUP });
  assert.equal((await app.inject({ method: 'GET', url: '/investor/portfolio' })).statusCode, 401);

  delete map[TOKEN].values.balanceOf;
  const down = await app.inject({ method: 'GET', url: '/investor/portfolio', headers: { cookie: cookieFor(WALLET) } });
  assert.equal(down.statusCode, 503);
  assert.equal(down.json().reason, 'chain_unavailable');
  await app.close();

  const noChain = appWith();
  const off = await noChain.inject({
    method: 'GET',
    url: '/investor/portfolio',
    headers: { cookie: cookieFor(WALLET) },
  });
  assert.equal(off.json().reason, 'portfolio_unavailable');
  await noChain.close();
});

async function quotedStore() {
  const mintStore = new MemoryMintStore();
  const first = await createMintQuote({
    input: { wallet: WALLET, usdtAmount: (10n * ONE_USDT).toString() },
    store: mintStore,
    now: NOW,
  });
  const second = await createMintQuote({
    input: { wallet: WALLET, usdtAmount: (25n * ONE_USDT).toString() },
    store: mintStore,
    now: NOW,
  });
  const theirs = await createMintQuote({
    input: { wallet: OTHER_WALLET, usdtAmount: (5n * ONE_USDT).toString() },
    store: mintStore,
    now: NOW,
  });
  assert.ok('quote' in first && 'quote' in second && 'quote' in theirs);
  await recordMintDeposit({
    input: {
      intentId: first.quote.intentId,
      payerAddress: WALLET,
      tokenAddress: '0x7777777777777777777777777777777777777777',
      amount: (10n * ONE_USDT).toString(),
      txHash: '0xdep1',
      blockNumber: 493,
    },
    store: mintStore,
    now: NOW,
  });
  return { mintStore, first: first.quote, second: second.quote, theirs: theirs.quote };
}

test('quotes lists only the signed-in wallet, newest first, with confirmations', async () => {
  const { mintStore, first, second } = await quotedStore();
  const app = appWith({ chain: fakeChain(contracts(), 500), mintStore });

  const response = await app.inject({ method: 'GET', url: '/investor/quotes', headers: { cookie: cookieFor(WALLET) } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.currentBlock, 500);
  assert.deepEqual(
    body.quotes.map((quote: InvestorQuoteDto) => quote.intentId),
    [second.intentId, first.intentId],
  );
  const deposited = body.quotes[1] as InvestorQuoteDto;
  assert.equal(deposited.status, 'deposited');
  assert.deepEqual(deposited.deposit, { txHash: '0xdep1', blockNumber: 493, amount: (10n * ONE_USDT).toString() });
  assert.deepEqual(deposited.confirmations, { current: 7, required: 12 });
  assert.equal(body.quotes[0].confirmations, null);
  await app.close();
});

test('a quote of another wallet answers 404 like a missing one', async () => {
  const { mintStore, first, theirs } = await quotedStore();
  const app = appWith({ mintStore });

  const own = await app.inject({
    method: 'GET',
    url: `/investor/quotes/${first.intentId}`,
    headers: { cookie: cookieFor(WALLET) },
  });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().quote.intentId, first.intentId);
  // Without a chain the quote still loads, confirmations are just unknown.
  assert.equal(own.json().currentBlock, null);
  assert.equal(own.json().quote.confirmations, null);

  const foreign = await app.inject({
    method: 'GET',
    url: `/investor/quotes/${theirs.intentId}`,
    headers: { cookie: cookieFor(WALLET) },
  });
  assert.equal(foreign.statusCode, 404);
  const missing = await app.inject({
    method: 'GET',
    url: '/investor/quotes/0xnope',
    headers: { cookie: cookieFor(WALLET) },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/investor/quotes' })).statusCode, 401);
  await app.close();
});

test('confirmations are capped at 12 and never negative', async () => {
  const { mintStore, first } = await quotedStore();
  const quote = (await mintStore.getQuote(first.intentId))!;
  const deposit = (await mintStore.getDeposit(first.intentId))!;
  assert.deepEqual(toInvestorQuote(quote, deposit, 900).confirmations, { current: 12, required: 12 });
  assert.deepEqual(toInvestorQuote(quote, deposit, 480).confirmations, { current: 0, required: 12 });
});
