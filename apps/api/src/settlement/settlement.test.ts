import assert from 'node:assert/strict';
import test from 'node:test';

import { ESCROW_EVENTS_IFACE } from '../../../../config/escrowEvents.ts';
import { ONE_SHARE, ONE_USDT } from '../../../../config/eqowa.ts';

import { MemoryIdentityStore } from '../kyc/identityStore.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';
import { approveSafeMint, createMintQuote, type MintExecutor } from '../mint/pipeline.ts';

import { ESCROW_DEPOSITS_CURSOR, MemorySyncStateStore } from './syncState.ts';
import { createSettlementWorker } from './worker.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const ESCROW = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333';
const OTHER_TOKEN = '0x4444444444444444444444444444444444444444';
const TEN_USDT = 10n * ONE_USDT;

/** Unix seconds of block 0. Block n is 2 seconds later per block, like Polygon. */
const GENESIS = Date.parse('2026-09-25T12:00:00.000Z') / 1000;
const START = new Date(GENESIS * 1000);

type FakeLog = {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  index: number;
  blockNumber: number;
};

class FakeChain {
  head = 0;
  logs: FakeLog[] = [];
  receipts = new Map<string, number>();
  logCalls: Array<[number, number]> = [];
  failLogsFrom: number | undefined;

  async getBlockNumber() {
    return this.head;
  }

  async getLogs(filter: { address: string; fromBlock: number; toBlock: number }) {
    const from = Number(filter.fromBlock);
    const to = Number(filter.toBlock);
    this.logCalls.push([from, to]);
    if (this.failLogsFrom === from) {
      throw new Error('rpc limit');
    }
    return this.logs.filter(
      (log) =>
        log.blockNumber >= from && log.blockNumber <= to && log.address.toLowerCase() === filter.address.toLowerCase(),
    );
  }

  async getBlock(blockNumber: number) {
    return { timestamp: GENESIS + blockNumber * 2 };
  }

  async getTransactionReceipt(hash: string) {
    const status = this.receipts.get(hash);
    return status === undefined ? null : { status };
  }

  deposit(intentId: string, amount: bigint, blockNumber: number, token: string = USDT) {
    const encoded = ESCROW_EVENTS_IFACE.encodeEventLog('Deposited', [intentId, WALLET, amount, token]);
    this.logs.push({
      address: ESCROW,
      topics: encoded.topics as string[],
      data: encoded.data,
      transactionHash: `0x${(this.logs.length + 1).toString(16).padStart(64, '0')}`,
      index: 0,
      blockNumber,
    });
  }
}

/** Executor whose mints land at once unless told otherwise. */
function fakeExecutor(chain: FakeChain, options: { fail?: boolean; land?: boolean } = {}) {
  const sent: Array<{ to: string; shareAmount: bigint }> = [];
  const executor: MintExecutor = {
    async send(call) {
      if (options.fail) {
        sent.push(call);
        throw new Error('nonce too low');
      }
      sent.push(call);
      const hash = `0xmint${sent.length}`;
      if (options.land !== false) {
        chain.receipts.set(hash, 1);
      }
      return hash;
    },
    async wait() {
      throw new Error('the worker must not block on wait');
    },
  };
  return { executor, sent };
}

async function setup(options: { indexFromBlock?: number; chunkSize?: number; now?: Date } = {}) {
  const chain = new FakeChain();
  const mintStore = new MemoryMintStore();
  const identities = new MemoryIdentityStore();
  const syncStore = new MemorySyncStateStore();
  await identities.recordKyc({
    walletAddress: WALLET,
    onchainIdAddress: '0x5555555555555555555555555555555555555555',
    countryCode: 566,
    kycStatus: 'approved',
    applicantId: 'app-1',
    claims: [1, 2],
  });
  const quote = await createMintQuote({
    input: { wallet: WALLET, usdtAmount: TEN_USDT.toString() },
    store: mintStore,
    now: START,
  });
  if ('error' in quote) {
    throw new Error(quote.error);
  }

  const build = (mint: MintExecutor) =>
    createSettlementWorker({
      chain: chain as never,
      escrowAddress: ESCROW,
      usdtAddress: USDT,
      indexFromBlock: options.indexFromBlock ?? 1,
      mintStore,
      identities,
      syncStore,
      mint,
      now: () => options.now ?? START,
      chunkSize: options.chunkSize,
      log: { info() {}, warn() {}, error() {} },
    });

  return { chain, mintStore, syncStore, intentId: quote.quote.intentId, build };
}

test('records a 12-deep deposit with its block timestamp and mints it', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain);
  ctx.chain.deposit(ctx.intentId, TEN_USDT, 100);
  ctx.chain.head = 112;

  const result = await ctx.build(executor).tick();

  const deposit = await ctx.mintStore.getDeposit(ctx.intentId);
  assert.equal(deposit?.recordedAt.getTime(), (GENESIS + 200) * 1000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.shareAmount, 2n * ONE_SHARE);
  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'minted');
  assert.equal(result.depositsRecorded, 1);
  assert.equal(result.mintsConfirmed, 1);
});

test('does not see a deposit until it is 12 blocks deep', async () => {
  const ctx = await setup();
  const { executor } = fakeExecutor(ctx.chain);
  const worker = ctx.build(executor);
  ctx.chain.deposit(ctx.intentId, TEN_USDT, 100);

  ctx.chain.head = 111;
  await worker.tick();
  assert.equal(await ctx.mintStore.getDeposit(ctx.intentId), undefined);

  ctx.chain.head = 112;
  await worker.tick();
  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'minted');
});

test('catching up hours later still mints a deposit made inside the quote window', async () => {
  const ctx = await setup({ now: new Date(START.getTime() + 2 * 60 * 60 * 1000) });
  const { executor } = fakeExecutor(ctx.chain);
  ctx.chain.deposit(ctx.intentId, TEN_USDT, 50); // block time START + 100 s, quote lasts 900 s
  ctx.chain.head = 4000;

  await ctx.build(executor).tick();

  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'minted');
  assert.equal(ctx.mintStore.exceptions.length, 0);
});

test('opens unknown_intent and wrong_token once, even when the range is scanned again', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain);
  const stray = `0x${'ab'.repeat(32)}`;
  ctx.chain.deposit(stray, TEN_USDT, 100);
  ctx.chain.deposit(ctx.intentId, TEN_USDT, 101, OTHER_TOKEN);
  ctx.chain.head = 200;
  const worker = ctx.build(executor);

  await worker.tick();
  ctx.syncStore.cursors.delete(ESCROW_DEPOSITS_CURSOR);
  await worker.tick();

  const kinds = ctx.mintStore.exceptions.map((row) => row.kind).sort();
  assert.deepEqual(kinds, ['unknown_intent', 'wrong_token']);
  assert.equal(await ctx.mintStore.getDeposit(ctx.intentId), undefined);
  assert.equal(sent.length, 0);
});

test('a failed send opens one mint_failed and is not retried on later ticks', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain, { fail: true });
  ctx.chain.deposit(ctx.intentId, TEN_USDT, 100);
  ctx.chain.head = 112;
  const worker = ctx.build(executor);

  await worker.tick();
  await worker.tick();
  await worker.tick();

  assert.equal(sent.length, 1);
  assert.equal(ctx.mintStore.exceptions.filter((row) => row.kind === 'mint_failed').length, 1);
  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'deposited');
});

test('a mint still pending is confirmed on a later tick without sending again', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain, { land: false });
  ctx.chain.deposit(ctx.intentId, TEN_USDT, 100);
  ctx.chain.head = 112;
  const worker = ctx.build(executor);

  const first = await worker.tick();
  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'minting');
  assert.equal(first.mintsSent, 1);

  ctx.chain.receipts.set('0xmint1', 1);
  const second = await worker.tick();

  assert.equal(sent.length, 1);
  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'minted');
  assert.equal(second.mintsConfirmed, 1);
});

test('after a restart it reconciles minting intents from their receipts', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain);
  ctx.chain.head = 50;
  await ctx.mintStore.transitionQuoteStatus(ctx.intentId, ['quoted'], 'minting');
  await ctx.mintStore.setMintTxHash(ctx.intentId, '0xlanded');
  ctx.chain.receipts.set('0xlanded', 1);

  await ctx.build(executor).tick();

  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'minted');
  assert.equal(sent.length, 0);
});

test('a minting intent without a hash goes to ops once and is never sent', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain);
  ctx.chain.head = 50;
  await ctx.mintStore.transitionQuoteStatus(ctx.intentId, ['quoted'], 'minting');
  const worker = ctx.build(executor);

  await worker.tick();
  await worker.tick();

  assert.equal(ctx.mintStore.exceptions.filter((row) => row.kind === 'mint_unconfirmed').length, 1);
  assert.equal((await ctx.mintStore.getQuote(ctx.intentId))?.status, 'minting');
  assert.equal(sent.length, 0);
});

test('scans in chunks, stores the cursor, and resumes after an RPC failure', async () => {
  const ctx = await setup({ indexFromBlock: 100, chunkSize: 2000 });
  const { executor } = fakeExecutor(ctx.chain);
  ctx.chain.head = 5012;
  ctx.chain.failLogsFrom = 2100;
  const worker = ctx.build(executor);

  const failed = await worker.tick();
  assert.equal(failed.errors, 1);
  assert.equal(await ctx.syncStore.getCursor(ESCROW_DEPOSITS_CURSOR), 2099);

  ctx.chain.failLogsFrom = undefined;
  ctx.chain.logCalls = [];
  await worker.tick();
  assert.deepEqual(ctx.chain.logCalls, [
    [2100, 4099],
    [4100, 5000],
  ]);
  assert.equal(await ctx.syncStore.getCursor(ESCROW_DEPOSITS_CURSOR), 5000);

  ctx.chain.logCalls = [];
  await worker.tick();
  assert.deepEqual(ctx.chain.logCalls, []);
});

test('overlapping tick calls share one pass', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain);
  ctx.chain.deposit(ctx.intentId, TEN_USDT, 100);
  ctx.chain.head = 112;
  const worker = ctx.build(executor);

  const [a, b] = await Promise.all([worker.tick(), worker.tick()]);

  assert.equal(a, b);
  assert.equal(sent.length, 1);
});

test('holds a 100,000 USDT deposit for Safe sign-off, then mints it after approval', async () => {
  const ctx = await setup();
  const { executor, sent } = fakeExecutor(ctx.chain);
  const big = await createMintQuote({
    input: { wallet: WALLET, usdtAmount: (100_000n * ONE_USDT).toString() },
    store: ctx.mintStore,
    now: START,
  });
  if ('error' in big) {
    throw new Error(big.error);
  }
  const intentId = big.quote.intentId;
  ctx.chain.deposit(intentId, 100_000n * ONE_USDT, 100);
  ctx.chain.head = 112;
  const worker = ctx.build(executor);

  await worker.tick();
  await worker.tick();
  assert.equal((await ctx.mintStore.getQuote(intentId))?.status, 'awaiting_safe_approval');
  assert.equal(sent.length, 0);

  await approveSafeMint({
    intentId,
    store: ctx.mintStore,
    safeTxHash: `0x${'5a'.repeat(32)}`,
    actor: 'larry',
    now: START,
  });
  await worker.tick();

  assert.equal((await ctx.mintStore.getQuote(intentId))?.status, 'minted');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.shareAmount, 20_000n * ONE_SHARE);
});
