import assert from 'node:assert/strict';
import test from 'node:test';

import { ZeroAddress } from 'ethers';

import type { HoldersResponse } from '../../../../config/api.ts';
import { ONE_SHARE } from '../../../../config/eqowa.ts';
import { TOKEN_INDEX_IFACE } from '../../../../config/tokenEvents.ts';

import { createTokenIndexerFromEnv } from '../bootstrap.ts';
import { buildApp } from '../index.ts';
import { MemorySyncStateStore } from '../settlement/syncState.ts';

import { MemoryTokenLedger } from './ledger.ts';
import { TOKEN_TRANSFERS_CURSOR, createTokenIndexer } from './tokenWorker.ts';

const TOKEN = '0x1111111111111111111111111111111111111111';
const ALICE = '0x2222222222222222222222222222222222222222';
const BOB = '0x3333333333333333333333333333333333333333';
const AGENT = '0x4444444444444444444444444444444444444444';
const OTHER_TOKEN = '0x5555555555555555555555555555555555555555';

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
  logCalls: Array<[number, number]> = [];
  failLogsFrom: number | undefined;

  async getBlockNumber() {
    return this.head;
  }

  async getLogs(filter: { address: string; topics: string[][]; fromBlock: number; toBlock: number }) {
    const from = Number(filter.fromBlock);
    const to = Number(filter.toBlock);
    this.logCalls.push([from, to]);
    if (this.failLogsFrom === from) {
      throw new Error('rpc limit');
    }
    return this.logs.filter(
      (log) =>
        log.blockNumber >= from &&
        log.blockNumber <= to &&
        log.address.toLowerCase() === filter.address.toLowerCase() &&
        filter.topics[0].includes(log.topics[0]),
    ) as never;
  }

  private push(name: 'Transfer' | 'AddressFrozen', args: unknown[], blockNumber: number, address = TOKEN) {
    const encoded = TOKEN_INDEX_IFACE.encodeEventLog(name, args);
    this.logs.push({
      address,
      topics: encoded.topics as string[],
      data: encoded.data,
      transactionHash: `0x${(this.logs.length + 1).toString(16).padStart(64, '0')}`,
      index: this.logs.filter((log) => log.blockNumber === blockNumber).length,
      blockNumber,
    });
  }

  mint(to: string, shares: bigint, block: number) {
    this.push('Transfer', [ZeroAddress, to, shares * ONE_SHARE], block);
  }

  transfer(from: string, to: string, shares: bigint, block: number) {
    this.push('Transfer', [from, to, shares * ONE_SHARE], block);
  }

  burn(from: string, shares: bigint, block: number) {
    this.push('Transfer', [from, ZeroAddress, shares * ONE_SHARE], block);
  }

  freeze(wallet: string, frozen: boolean, block: number) {
    this.push('AddressFrozen', [wallet, frozen, AGENT], block);
  }

  otherTokenMint(to: string, shares: bigint, block: number) {
    this.push('Transfer', [ZeroAddress, to, shares * ONE_SHARE], block, OTHER_TOKEN);
  }
}

const quiet = { info() {}, warn() {}, error() {} };

function setup(options: { chunkSize?: number; indexFromBlock?: number } = {}) {
  const chain = new FakeChain();
  const ledger = new MemoryTokenLedger();
  const syncStore = new MemorySyncStateStore();
  const indexer = createTokenIndexer({
    chain,
    tokenAddress: TOKEN,
    indexFromBlock: options.indexFromBlock ?? 1,
    ledger,
    syncStore,
    chunkSize: options.chunkSize,
    log: quiet,
  });
  return { chain, ledger, syncStore, indexer };
}

async function balance(ledger: MemoryTokenLedger, wallet: string) {
  return (await ledger.getBalance(TOKEN, wallet))?.balance ?? 0n;
}

test('mint, transfer and burn move balances and supply', async () => {
  const { chain, ledger, indexer } = setup();
  chain.mint(ALICE, 100n, 2);
  chain.transfer(ALICE, BOB, 30n, 3);
  chain.burn(BOB, 10n, 4);
  chain.head = 4 + 12;

  const result = await indexer.tick();

  assert.equal(result.applied, 3);
  assert.equal(result.scannedTo, 4);
  assert.equal(await balance(ledger, ALICE), 70n * ONE_SHARE);
  assert.equal(await balance(ledger, BOB), 20n * ONE_SHARE);
  assert.deepEqual(await ledger.stats(TOKEN), { holderWallets: 2, frozenWallets: 0, totalSupply: 90n * ONE_SHARE });
  // The zero address is never a holder.
  assert.equal(await ledger.getBalance(TOKEN, ZeroAddress), undefined);
});

test('reads only blocks 12 deep and picks the rest up later', async () => {
  const { chain, ledger, syncStore, indexer } = setup();
  chain.mint(ALICE, 5n, 2);
  chain.mint(BOB, 7n, 10);
  chain.head = 20;

  const first = await indexer.tick();
  assert.equal(first.scannedTo, 8);
  assert.equal(await balance(ledger, ALICE), 5n * ONE_SHARE);
  assert.equal(await balance(ledger, BOB), 0n);

  chain.head = 22;
  const second = await indexer.tick();
  assert.equal(second.scannedTo, 10);
  assert.equal(await balance(ledger, BOB), 7n * ONE_SHARE);
  assert.equal(await syncStore.getCursor(TOKEN_TRANSFERS_CURSOR), 10);
});

test('freeze and unfreeze set the flag without touching the balance', async () => {
  const { chain, ledger, indexer } = setup();
  chain.mint(ALICE, 9n, 2);
  chain.freeze(ALICE, true, 3);
  chain.freeze(BOB, true, 3);
  chain.head = 15;
  await indexer.tick();

  assert.equal((await ledger.getBalance(TOKEN, ALICE))?.frozen, true);
  assert.equal(await balance(ledger, ALICE), 9n * ONE_SHARE);
  // A frozen wallet without tokens is still listed, so ops can see it.
  const holders = await ledger.listHolders(TOKEN);
  assert.deepEqual(
    holders.map((row) => [row.walletAddress, row.frozen]),
    [
      [ALICE, true],
      [BOB, true],
    ],
  );
  assert.equal((await ledger.stats(TOKEN)).frozenWallets, 2);

  chain.freeze(ALICE, false, 4);
  chain.head = 16;
  await indexer.tick();
  assert.equal((await ledger.getBalance(TOKEN, ALICE))?.frozen, false);
});

test('scans in chunks and ignores other contracts', async () => {
  const { chain, ledger, indexer } = setup({ chunkSize: 5 });
  chain.mint(ALICE, 1n, 3);
  chain.mint(ALICE, 2n, 9);
  chain.otherTokenMint(ALICE, 50n, 9);
  chain.mint(BOB, 4n, 14);
  chain.head = 14 + 12;

  await indexer.tick();

  assert.deepEqual(chain.logCalls, [
    [1, 5],
    [6, 10],
    [11, 14],
  ]);
  assert.equal(await balance(ledger, ALICE), 3n * ONE_SHARE);
  assert.equal(await balance(ledger, BOB), 4n * ONE_SHARE);
});

test('a restart resumes from the cursor and a re-scan does not double count', async () => {
  const { chain, ledger, syncStore } = setup();
  chain.mint(ALICE, 10n, 2);
  chain.head = 14;
  const first = createTokenIndexer({ chain, tokenAddress: TOKEN, indexFromBlock: 1, ledger, syncStore, log: quiet });
  await first.tick();

  // Simulate a crash after the events were stored but before the cursor moved.
  await syncStore.setCursor(TOKEN_TRANSFERS_CURSOR, 0);
  chain.mint(BOB, 3n, 5);
  chain.head = 17;
  const restarted = createTokenIndexer({
    chain,
    tokenAddress: TOKEN,
    indexFromBlock: 1,
    ledger,
    syncStore,
    log: quiet,
  });
  const result = await restarted.tick();

  assert.equal(result.duplicates, 1);
  assert.equal(result.applied, 1);
  assert.equal(await balance(ledger, ALICE), 10n * ONE_SHARE);
  assert.equal(await balance(ledger, BOB), 3n * ONE_SHARE);
});

test('an RPC failure keeps the cursor on the last whole chunk', async () => {
  const { chain, ledger, syncStore, indexer } = setup({ chunkSize: 5 });
  chain.mint(ALICE, 1n, 3);
  chain.mint(BOB, 1n, 7);
  chain.head = 30;
  chain.failLogsFrom = 6;

  const failed = await indexer.tick();
  assert.equal(failed.errors, 1);
  assert.equal(failed.scannedTo, 5);
  assert.equal(await syncStore.getCursor(TOKEN_TRANSFERS_CURSOR), 5);
  assert.equal(await balance(ledger, BOB), 0n);

  chain.failLogsFrom = undefined;
  const recovered = await indexer.tick();
  assert.equal(recovered.errors, 0);
  assert.equal(await balance(ledger, BOB), 1n * ONE_SHARE);
});

test('the first scan starts at the token deploy block', async () => {
  const { chain, indexer } = setup({ indexFromBlock: 40 });
  chain.head = 60;
  await indexer.tick();
  assert.deepEqual(chain.logCalls, [[40, 48]]);
});

test('listHolders orders by balance and honours the limit', async () => {
  const { chain, ledger, indexer } = setup();
  chain.mint(ALICE, 2n, 2);
  chain.mint(BOB, 8n, 2);
  chain.mint(AGENT, 5n, 2);
  chain.head = 14;
  await indexer.tick();

  const top = await ledger.listHolders(TOKEN, { limit: 2 });
  assert.deepEqual(
    top.map((row) => row.walletAddress),
    [BOB, AGENT],
  );
});

test('GET /admin/holders lists indexed wallets behind the admin key', async () => {
  const { chain, ledger, syncStore, indexer } = setup();
  chain.mint(ALICE, 4n, 2);
  chain.mint(BOB, 6n, 3);
  chain.freeze(BOB, true, 3);
  chain.head = 15;
  await indexer.tick();

  const app = buildApp({ adminKey: 'k', ledger, syncStore, tokenAddress: TOKEN });
  const denied = await app.inject({ method: 'GET', url: '/admin/holders' });
  assert.equal(denied.statusCode, 401);

  const response = await app.inject({ method: 'GET', url: '/admin/holders?limit=1', headers: { 'x-admin-key': 'k' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    tokenAddress: TOKEN,
    indexedBlock: 3,
    stats: { holderWallets: 2, frozenWallets: 1, totalSupply: (10n * ONE_SHARE).toString() },
    holders: [{ walletAddress: BOB, balance: (6n * ONE_SHARE).toString(), frozen: true, updatedBlock: 3 }],
  } satisfies HoldersResponse);
  await app.close();
});

test('GET /admin/holders answers 503 without a ledger or token', async () => {
  const app = buildApp({ adminKey: 'k', tokenAddress: '' });
  const response = await app.inject({ method: 'GET', url: '/admin/holders', headers: { 'x-admin-key': 'k' } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().reason, 'holders_unavailable');
  await app.close();
});

test('createTokenIndexerFromEnv needs the token, RPC and deploy block', () => {
  const stores = { ledger: new MemoryTokenLedger(), syncStore: new MemorySyncStateStore() } as never;
  const chain = new FakeChain() as never;
  assert.deepEqual(createTokenIndexerFromEnv(stores, { TOKEN_INDEXER: 'off' }, chain), {
    disabled: 'TOKEN_INDEXER=off',
  });
  assert.deepEqual(createTokenIndexerFromEnv(stores, {}, undefined), {
    disabled: 'TOKEN_ADDRESS and AMOY_RPC_URL are required',
  });
  assert.deepEqual(createTokenIndexerFromEnv(stores, { TOKEN_ADDRESS: TOKEN }, chain), {
    disabled: 'set TOKEN_INDEX_FROM_BLOCK to the token deploy block',
  });
  assert.ok(
    'indexer' in createTokenIndexerFromEnv(stores, { TOKEN_ADDRESS: TOKEN, TOKEN_INDEX_FROM_BLOCK: '12' }, chain),
  );
});
