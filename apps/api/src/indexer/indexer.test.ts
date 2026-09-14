import assert from 'node:assert/strict';
import test from 'node:test';
import { ZeroAddress } from 'ethers';

import { TOKEN_INDEX_IFACE } from '../../../../config/tokenEvents.ts';

import { indexTokenLogs } from './indexLogs.ts';
import { MemoryEventStore } from './memoryStore.ts';

const TOKEN = '0x1111111111111111111111111111111111111111';
const ALICE = '0x2222222222222222222222222222222222222222';
const BOB = '0x3333333333333333333333333333333333333333';
const AGENT = '0x4444444444444444444444444444444444444444';

function logFromEvent(
  name: 'Transfer' | 'AddressFrozen',
  args: unknown[],
  meta: { hash: string; index: number; block: number },
) {
  const encoded = TOKEN_INDEX_IFACE.encodeEventLog(name, args);
  return {
    address: TOKEN,
    topics: encoded.topics as string[],
    data: encoded.data,
    transactionHash: meta.hash,
    index: meta.index,
    blockNumber: meta.block,
  };
}

const asset = {
  tokenAddress: TOKEN,
  name: 'EQOWA Group Shares',
  symbol: 'EQOWAG',
  decimals: 6,
};

test('indexes a mint Transfer and an AddressFrozen log', async () => {
  const store = new MemoryEventStore();
  const logs = [
    logFromEvent('Transfer', [ZeroAddress, ALICE, 5_000_000n], {
      hash: '0xaaa1',
      index: 0,
      block: 10,
    }),
    logFromEvent('AddressFrozen', [ALICE, true, AGENT], {
      hash: '0xaaa2',
      index: 1,
      block: 11,
    }),
  ];

  const result = await indexTokenLogs(store, asset, logs as never);

  assert.equal(result.decoded, 2);
  assert.equal(result.inserted, 2);
  const rows = await store.listTransactions(TOKEN);
  assert.equal(rows[0].eventName, 'Transfer');
  assert.equal(rows[0].fromAddress, ZeroAddress);
  assert.equal(rows[0].toAddress, ALICE);
  assert.equal(rows[0].amount, 5_000_000n);
  assert.equal(rows[1].eventName, 'AddressFrozen');
  assert.equal(rows[1].fromAddress, ALICE);
  assert.equal(rows[1].frozen, true);
});

test('ignores unrelated logs and skips duplicates', async () => {
  const store = new MemoryEventStore();
  const transfer = logFromEvent('Transfer', [ALICE, BOB, 1_000_000n], {
    hash: '0xbbb1',
    index: 4,
    block: 20,
  });
  const noise = {
    ...transfer,
    topics: ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
    data: '0x',
    transactionHash: '0xbbb2',
    index: 5,
  };

  await indexTokenLogs(store, asset, [transfer] as never);
  const second = await indexTokenLogs(store, asset, [transfer, noise] as never);

  assert.equal(second.decoded, 1);
  assert.equal(second.duplicates, 1);
  assert.equal(second.inserted, 0);
  assert.equal((await store.listTransactions(TOKEN)).length, 1);
});
