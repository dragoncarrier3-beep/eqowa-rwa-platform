import assert from 'node:assert/strict';
import test from 'node:test';

import { ONE_SHARE, ONE_USDT, SHARE_PRICE_USDT } from '../../../../config/eqowa.ts';
import { CONFIRMATION_BLOCKS, QUOTE_TTL_SECONDS } from '../../../../config/mint.ts';

import { buildApp } from '../index.ts';
import { MemoryIdentityStore } from '../kyc/identityStore.ts';

import { MemoryMintStore } from './mintStore.ts';
import {
  confirmMintQuote,
  createMintQuote,
  recordMintDeposit,
  settleMintQuote,
  type MintExecutor,
} from './pipeline.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const TEN_USDT = (10n * ONE_USDT).toString();
const SEVEN_USDT = (7n * ONE_USDT).toString();
const FOUR_USDT = (4n * ONE_USDT).toString();

const START = new Date('2026-09-15T12:00:00.000Z');

/** Executor whose mint lands immediately. Records every call. */
function okExecutor(txHash: string = '0xmint') {
  const sent: Array<{ to: string; shareAmount: bigint }> = [];
  const executor: MintExecutor = {
    send: async ({ to, shareAmount }) => {
      sent.push({ to, shareAmount });
      return txHash;
    },
    wait: async () => 'success',
  };
  return { executor, sent };
}

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

async function quoted(store: MemoryMintStore, amount: string = TEN_USDT, now: Date = START) {
  const result = await createMintQuote({
    input: { wallet: WALLET, usdtAmount: amount },
    store,
    now,
  });
  if ('error' in result) {
    throw new Error(result.error);
  }
  return result.quote;
}

async function deposited(
  store: MemoryMintStore,
  quote: { intentId: string },
  amount: string,
  now: Date,
  blockNumber: number,
) {
  return recordMintDeposit({
    input: {
      intentId: quote.intentId,
      payerAddress: WALLET,
      tokenAddress: TOKEN,
      amount,
      txHash: '0xabc',
      blockNumber,
    },
    store,
    now,
  });
}

test('quotes 10 USDT as two shares with a 15-minute expiry', async () => {
  const quote = await quoted(new MemoryMintStore());

  assert.equal(quote.usdtAmount, TEN_USDT);
  assert.equal(quote.shares, '2');
  assert.equal(quote.shareAmount, (2n * ONE_SHARE).toString());
  assert.equal(quote.fundsAmount, (8n * ONE_USDT).toString());
  assert.equal(quote.feeAmount, (2n * ONE_USDT).toString());
  assert.equal(quote.remainderAmount, '0');
  assert.equal(new Date(quote.quoteExpiresAt).getTime(), START.getTime() + QUOTE_TTL_SECONDS * 1000);
});

test('refuses a quote below one share', async () => {
  const result = await createMintQuote({
    input: { wallet: WALLET, usdtAmount: FOUR_USDT },
    store: new MemoryMintStore(),
    now: START,
  });
  assert.deepEqual(result, { error: 'below_share_price' });
});

test('quotes 7 USDT as one share and keeps 2 USDT remainder', async () => {
  const quote = await quoted(new MemoryMintStore(), SEVEN_USDT);
  assert.equal(quote.shares, '1');
  assert.equal(quote.remainderAmount, (2n * ONE_USDT).toString());
});

test('waits for a deposit, then expires if none arrives in 15 minutes', async () => {
  const store = new MemoryMintStore();
  const identities = await approvedIdentities();
  const quote = await quoted(store);

  const waiting = await settleMintQuote({
    intentId: quote.intentId,
    store,
    identities,
    now: START,
    currentBlock: 1,
  });
  assert.equal('decision' in waiting && waiting.decision.action === 'wait', true);

  const expired = await settleMintQuote({
    intentId: quote.intentId,
    store,
    identities,
    now: new Date(START.getTime() + QUOTE_TTL_SECONDS * 1000 + 1),
    currentBlock: 1,
  });
  assert.equal(expired.quote?.status, 'expired');
  assert.equal(store.exceptions[0]?.kind, 'quote_expired');
});

test('rejects a deposit that arrives after the quote expires', async () => {
  const store = new MemoryMintStore();
  const identities = await approvedIdentities();
  const quote = await quoted(store);
  const late = new Date(START.getTime() + QUOTE_TTL_SECONDS * 1000 + 1);

  await deposited(store, quote, TEN_USDT, late, 100);
  const settled = await settleMintQuote({
    intentId: quote.intentId,
    store,
    identities,
    now: late,
    currentBlock: 100 + CONFIRMATION_BLOCKS,
  });

  assert.equal(settled.quote?.status, 'rejected');
  assert.equal(settled.quote?.rejectReason, 'quote_expired');
});

test('rejects an amount mismatch and waits until 12 confirmations', async () => {
  const store = new MemoryMintStore();
  const identities = await approvedIdentities();
  const quote = await quoted(store);

  await deposited(store, quote, SHARE_PRICE_USDT.toString(), START, 100);
  const mismatch = await settleMintQuote({
    intentId: quote.intentId,
    store,
    identities,
    now: START,
    currentBlock: 112,
  });
  assert.equal(mismatch.quote?.rejectReason, 'amount_mismatch');

  const store2 = new MemoryMintStore();
  const quote2 = await quoted(store2);
  await deposited(store2, quote2, TEN_USDT, START, 100);

  const waiting = await settleMintQuote({
    intentId: quote2.intentId,
    store: store2,
    identities,
    now: START,
    currentBlock: 111,
  });
  assert.equal('decision' in waiting && waiting.decision.action === 'wait', true);
  if ('decision' in waiting && waiting.decision.action === 'wait') {
    assert.equal(waiting.decision.reason, 'awaiting_confirmations');
    assert.equal(waiting.decision.confirmations, 11);
  }
});

test('mints after 12 confirmations when KYC is approved, and keeps remainder as an exception', async () => {
  const store = new MemoryMintStore();
  const identities = await approvedIdentities();
  const quote = await quoted(store, SEVEN_USDT);
  await deposited(store, quote, SEVEN_USDT, START, 100);

  const settled = await settleMintQuote({
    intentId: quote.intentId,
    store,
    identities,
    now: START,
    currentBlock: 112,
    mint: okExecutor().executor,
  });

  assert.equal(settled.quote?.status, 'minted');
  assert.equal('decision' in settled && settled.decision.action === 'mint', true);
  if ('decision' in settled && settled.decision.action === 'mint' && 'shareAmount' in settled.decision) {
    assert.equal(settled.decision.shareAmount, ONE_SHARE.toString());
    assert.equal(settled.decision.remainderAmount, (2n * ONE_USDT).toString());
  }
  assert.equal(store.exceptions[0]?.kind, 'remainder');

  const again = await settleMintQuote({
    intentId: quote.intentId,
    store,
    identities,
    now: START,
    currentBlock: 200,
  });
  assert.equal(again.quote?.status, 'minted');
});

test('does not mint without an approved KYC record', async () => {
  const store = new MemoryMintStore();
  const quote = await quoted(store);
  await deposited(store, quote, TEN_USDT, START, 100);

  const settled = await settleMintQuote({
    intentId: quote.intentId,
    store,
    identities: new MemoryIdentityStore(),
    now: START,
    currentBlock: 112,
  });

  assert.equal(settled.quote?.rejectReason, 'kyc_not_approved');
});

test('POST /mint/quotes and /mint/settle run the same gates', async () => {
  const mintStore = new MemoryMintStore();
  const identities = await approvedIdentities();
  const app = buildApp({ mintStore, identityStore: identities, now: () => START, mint: okExecutor().executor });

  const quotedResponse = await app.inject({
    method: 'POST',
    url: '/mint/quotes',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ wallet: WALLET, usdtAmount: TEN_USDT }),
  });
  assert.equal(quotedResponse.statusCode, 200);
  const intentId = quotedResponse.json().quote.intentId;

  const depositResponse = await app.inject({
    method: 'POST',
    url: '/mint/deposits',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      intentId,
      payerAddress: WALLET,
      tokenAddress: TOKEN,
      amount: TEN_USDT,
      txHash: '0xdef',
      blockNumber: 50,
    }),
  });
  assert.equal(depositResponse.statusCode, 200);

  const waiting = await app.inject({
    method: 'POST',
    url: '/mint/settle',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ intentId, currentBlock: 61 }),
  });
  assert.equal(waiting.json().decision.reason, 'awaiting_confirmations');

  const minted = await app.inject({
    method: 'POST',
    url: '/mint/settle',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ intentId, currentBlock: 62 }),
  });
  assert.equal(minted.statusCode, 200);
  assert.equal(minted.json().quote.status, 'minted');
  assert.equal(minted.json().decision.shares, '2');
  await app.close();
});

async function readyToMint(amount: string = TEN_USDT) {
  const store = new MemoryMintStore();
  const identities = await approvedIdentities();
  const quote = await quoted(store, amount);
  await deposited(store, quote, amount, START, 100);
  return { store, identities, quote };
}

function settle(ctx: Awaited<ReturnType<typeof readyToMint>>, mint?: MintExecutor) {
  return settleMintQuote({
    intentId: ctx.quote.intentId,
    store: ctx.store,
    identities: ctx.identities,
    now: START,
    currentBlock: 112,
    mint,
  });
}

test('sends the agent mint, stores its hash, and marks minted only after the receipt', async () => {
  const ctx = await readyToMint();
  const { executor, sent } = okExecutor('0xabc123');

  const minted = await settle(ctx, executor);

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, WALLET);
  assert.equal(sent[0]?.shareAmount, 2n * ONE_SHARE);
  assert.equal(minted.quote?.status, 'minted');
  assert.equal((await ctx.store.getQuote(ctx.quote.intentId))?.mintTxHash, '0xabc123');
  if ('decision' in minted && minted.decision.action === 'mint') {
    assert.equal(minted.decision.txHash, '0xabc123');
  }
  const mintActions = ctx.store.audit.map((row) => row.action).filter((action) => action.startsWith('mint.'));
  assert.deepEqual(mintActions, ['mint.sent', 'mint.confirmed']);
});

test('never marks an intent minted when no executor is wired', async () => {
  const ctx = await readyToMint();

  const result = await settle(ctx);

  assert.equal('error' in result && result.error, 'mint_unavailable');
  assert.equal((await ctx.store.getQuote(ctx.quote.intentId))?.status, 'deposited');
});

test('a failed send opens one mint_failed and pauses retries until ops resolve it', async () => {
  const ctx = await readyToMint();
  let attempts = 0;
  const failing: MintExecutor = {
    send: async () => {
      attempts += 1;
      throw new Error('rpc down');
    },
    wait: async () => 'success',
  };

  const first = await settle(ctx, failing);
  const second = await settle(ctx, failing);
  const third = await settle(ctx, failing);

  assert.equal('error' in first && first.error, 'mint_failed');
  assert.equal('error' in second && second.error, 'mint_paused');
  assert.equal('error' in third && third.error, 'mint_paused');
  assert.equal(attempts, 1);
  assert.equal(ctx.store.exceptions.filter((row) => row.kind === 'mint_failed').length, 1);
  assert.equal((await ctx.store.getQuote(ctx.quote.intentId))?.status, 'deposited');

  await ctx.store.resolveException(ctx.store.exceptions[0]!.id, {
    actor: 'ops',
    resolution: 'rpc back',
    now: START,
  });
  const retried = await settle(ctx, okExecutor().executor);
  assert.equal(retried.quote?.status, 'minted');
});

test('a reverted mint returns the intent to deposited and pauses it', async () => {
  const ctx = await readyToMint();
  const reverting: MintExecutor = { send: async () => '0xbad', wait: async () => 'reverted' };

  const result = await settle(ctx, reverting);

  assert.equal('error' in result && result.error, 'mint_failed');
  assert.equal((await ctx.store.getQuote(ctx.quote.intentId))?.status, 'deposited');
  assert.equal(ctx.store.exceptions[0]?.details.txHash, '0xbad');
});

test('a pending receipt leaves the intent in minting, and a later settle confirms without re-sending', async () => {
  const ctx = await readyToMint();
  const pending: MintExecutor = { send: async () => '0xslow', wait: async () => 'pending' };

  const result = await settle(ctx, pending);
  assert.equal('error' in result && result.error, 'mint_pending');
  assert.equal((await ctx.store.getQuote(ctx.quote.intentId))?.status, 'minting');

  const { executor, sent } = okExecutor('0xother');
  const confirmed = await settle(ctx, executor);
  assert.equal(sent.length, 0);
  assert.equal(confirmed.quote?.status, 'minted');
  if ('decision' in confirmed && confirmed.decision.action === 'mint') {
    assert.equal(confirmed.decision.txHash, '0xslow');
  }
});

test('an intent stuck in minting without a hash goes to ops once and is never re-sent', async () => {
  const ctx = await readyToMint();
  await ctx.store.transitionQuoteStatus(ctx.quote.intentId, ['deposited'], 'minting');
  const confirm = () =>
    confirmMintQuote({ intentId: ctx.quote.intentId, store: ctx.store, waitFor: async () => 'success' });

  const first = await confirm();
  await confirm();

  assert.equal('error' in first && first.error, 'mint_unconfirmed');
  assert.equal(ctx.store.exceptions.filter((row) => row.kind === 'mint_unconfirmed').length, 1);
  assert.equal((await ctx.store.getQuote(ctx.quote.intentId))?.status, 'minting');
});

test('only one caller can claim an intent for minting', async () => {
  const ctx = await readyToMint();

  const first = await ctx.store.transitionQuoteStatus(ctx.quote.intentId, ['deposited'], 'minting');
  const second = await ctx.store.transitionQuoteStatus(ctx.quote.intentId, ['deposited'], 'minting');

  assert.equal(first, true);
  assert.equal(second, false);
  const minting = await ctx.store.listQuotes({ statuses: ['minting'] });
  assert.deepEqual(
    minting.map((row) => row.intentId),
    [ctx.quote.intentId],
  );
});

test('POST /mint/settle answers 503 without an executor', async () => {
  const ctx = await readyToMint();
  const app = buildApp({ mintStore: ctx.store, identityStore: ctx.identities, now: () => START });

  const response = await app.inject({
    method: 'POST',
    url: '/mint/settle',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ intentId: ctx.quote.intentId, currentBlock: 112 }),
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().reason, 'mint_unavailable');
  await app.close();
});
