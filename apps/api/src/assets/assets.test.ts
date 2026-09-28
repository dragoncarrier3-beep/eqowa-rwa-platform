import assert from 'node:assert/strict';
import test from 'node:test';

import { Interface, type TransactionRequest } from 'ethers';

import { BALANCE_CAP_ABI, DAILY_MINT_CAP_ABI, HOLDER_COUNT_CAP_ABI, TOKEN_VIEW_ABI } from '../../../../config/abis.ts';
import type { AssetSummaryDto } from '../../../../config/api.ts';
import { ONE_SHARE, SHARE_PRICE_USDT } from '../../../../config/eqowa.ts';

import { createAssetCatalogFromEnv } from '../bootstrap.ts';
import { buildApp } from '../index.ts';
import { createAssetCatalog, readAssetSummary, type ChainReader } from './catalog.ts';

const TOKEN = '0x2222222222222222222222222222222222222222';
const COMPLIANCE = '0x3333333333333333333333333333333333333333';
const HOLDERS = '0x4444444444444444444444444444444444444444';
const BALANCE = '0x5555555555555555555555555555555555555555';
const MINT_CAP = '0x6666666666666666666666666666666666666666';
const NOW = new Date('2026-09-29T09:00:00.000Z');

type Contracts = Record<string, { abi: string[]; values: Record<string, unknown[]> }>;

function tokenContracts(overrides: { totalSupply?: bigint; paused?: boolean } = {}): Contracts {
  return {
    [TOKEN]: {
      abi: TOKEN_VIEW_ABI,
      values: {
        name: ['EQOWA Group Shares'],
        symbol: ['EQOWAG'],
        decimals: [6n],
        totalSupply: [overrides.totalSupply ?? 1_250n * ONE_SHARE],
        paused: [overrides.paused ?? false],
        compliance: [COMPLIANCE],
      },
    },
    [HOLDERS]: { abi: HOLDER_COUNT_CAP_ABI, values: { getHolderCount: [3n], getMaxHolderCount: [500n] } },
    [BALANCE]: { abi: BALANCE_CAP_ABI, values: { getMaxBalance: [150_000n * ONE_SHARE] } },
    [MINT_CAP]: {
      abi: DAILY_MINT_CAP_ABI,
      values: { getDailyMintCap: [250_000n * ONE_SHARE], getRemainingAllowance: [249_000n * ONE_SHARE] },
    },
  };
}

/** Answers eth_call with ABI-encoded values, so ethers decoding is exercised for real. */
function fakeChain(contracts: Contracts, blockNumber = 1_000) {
  const calls: { to: string; fn: string; blockTag: unknown; args: unknown[] }[] = [];
  const chain: ChainReader & { calls: typeof calls } = {
    provider: null,
    calls,
    getBlockNumber: async () => blockNumber,
    call: async (tx: TransactionRequest) => {
      const to = String(tx.to).toLowerCase();
      const entry = Object.entries(contracts).find(([address]) => address.toLowerCase() === to)?.[1];
      if (!entry) {
        throw new Error(`no contract at ${to}`);
      }
      const iface = new Interface(entry.abi);
      const data = String(tx.data);
      const fragment = iface.getFunction(data.slice(0, 10));
      if (!fragment) {
        throw new Error('unknown selector');
      }
      calls.push({
        to,
        fn: fragment.name,
        blockTag: tx.blockTag,
        args: [...iface.decodeFunctionData(fragment, data)],
      });
      const value = entry.values[fragment.name];
      if (!value) {
        throw new Error(`execution reverted: ${fragment.name}`);
      }
      return iface.encodeFunctionResult(fragment, value);
    },
  };
  return chain;
}

const ALL_MODULES = { holderCountCap: HOLDERS, balanceCap: BALANCE, dailyMintCap: MINT_CAP };

test('readAssetSummary reads token and module views at one block', async () => {
  const chain = fakeChain(tokenContracts());
  const asset = await readAssetSummary({
    chain,
    chainId: 80002,
    source: { tokenAddress: TOKEN, modules: ALL_MODULES },
    now: NOW,
  });

  assert.deepEqual(asset, {
    tokenAddress: TOKEN,
    chainId: 80002,
    name: 'EQOWA Group Shares',
    symbol: 'EQOWAG',
    decimals: 6,
    totalSupply: (1_250n * ONE_SHARE).toString(),
    paused: false,
    holderCount: 3,
    maxHolderCount: 500,
    maxBalance: (150_000n * ONE_SHARE).toString(),
    dailyMintCap: (250_000n * ONE_SHARE).toString(),
    remainingMintAllowance: (249_000n * ONE_SHARE).toString(),
    sharePriceUsdt: SHARE_PRICE_USDT.toString(),
    lockupDays: 730,
    blockNumber: 1_000,
    readAt: NOW.toISOString(),
  } satisfies AssetSummaryDto);

  assert.ok(chain.calls.every((call) => call.blockTag === 1_000));
  // Module views are asked about the token's own compliance contract.
  const moduleCalls = chain.calls.filter((call) => call.to !== TOKEN);
  assert.equal(moduleCalls.length, 5);
  assert.ok(moduleCalls.every((call) => String(call.args[0]).toLowerCase() === COMPLIANCE));
});

test('readAssetSummary leaves unconfigured module figures null', async () => {
  const chain = fakeChain(tokenContracts());
  const asset = await readAssetSummary({
    chain,
    chainId: 31337,
    source: { tokenAddress: TOKEN, modules: {} },
    now: NOW,
  });

  assert.equal(asset.holderCount, null);
  assert.equal(asset.maxHolderCount, null);
  assert.equal(asset.maxBalance, null);
  assert.equal(asset.dailyMintCap, null);
  assert.equal(asset.remainingMintAllowance, null);
  assert.ok(chain.calls.every((call) => call.to === TOKEN));
});

test('catalog caches reads for the TTL and drops a failed read', async () => {
  let at = NOW.getTime();
  const contracts = tokenContracts();
  const chain = fakeChain(contracts);
  const catalog = createAssetCatalog({
    chain,
    chainId: 80002,
    sources: [{ tokenAddress: TOKEN, modules: {} }],
    ttlMs: 15_000,
    now: () => new Date(at),
  });

  await Promise.all([catalog.list(), catalog.list(), catalog.get(TOKEN.toUpperCase().replace('0X', '0x'))]);
  const perRead = chain.calls.length;
  assert.equal(perRead, 6);

  at += 14_999;
  await catalog.list();
  assert.equal(chain.calls.length, perRead);

  at += 1;
  contracts[TOKEN].values.totalSupply = [7n * ONE_SHARE];
  const [fresh] = await catalog.list();
  assert.equal(fresh.totalSupply, (7n * ONE_SHARE).toString());

  at += 15_000;
  delete contracts[TOKEN].values.paused;
  await assert.rejects(catalog.list(), /paused/);
  contracts[TOKEN].values.paused = [true];
  const [recovered] = await catalog.list();
  assert.equal(recovered.paused, true);
});

test('catalog returns null for a token it does not list', async () => {
  const catalog = createAssetCatalog({
    chain: fakeChain(tokenContracts()),
    chainId: 80002,
    sources: [{ tokenAddress: TOKEN, modules: {} }],
    ttlMs: 15_000,
  });
  assert.equal(await catalog.get('0x7777777777777777777777777777777777777777'), null);
});

function appWithChain(chain: ChainReader) {
  return buildApp({
    assets: createAssetCatalog({
      chain,
      chainId: 80002,
      sources: [{ tokenAddress: TOKEN, modules: ALL_MODULES }],
      ttlMs: 0,
      now: () => NOW,
    }),
  });
}

test('GET /assets lists the token with live figures', async () => {
  const app = appWithChain(fakeChain(tokenContracts()));
  const response = await app.inject({ method: 'GET', url: '/assets' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.assets.length, 1);
  assert.equal(body.assets[0].symbol, 'EQOWAG');
  assert.equal(body.assets[0].holderCount, 3);
  await app.close();
});

test('GET /assets/:token answers 200, 400, 404 and 503', async () => {
  const contracts = tokenContracts();
  const app = appWithChain(fakeChain(contracts));

  const found = await app.inject({ method: 'GET', url: `/assets/${TOKEN}` });
  assert.equal(found.statusCode, 200);
  assert.equal(found.json().asset.totalSupply, (1_250n * ONE_SHARE).toString());

  const invalid = await app.inject({ method: 'GET', url: '/assets/not-an-address' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().reason, 'invalid_address');

  const unknown = await app.inject({ method: 'GET', url: '/assets/0x7777777777777777777777777777777777777777' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().reason, 'unknown_asset');

  delete contracts[TOKEN].values.totalSupply;
  const down = await app.inject({ method: 'GET', url: `/assets/${TOKEN}` });
  assert.equal(down.statusCode, 503);
  assert.equal(down.json().reason, 'chain_unavailable');
  const downList = await app.inject({ method: 'GET', url: '/assets' });
  assert.equal(downList.statusCode, 503);
  await app.close();
});

test('asset routes answer 503 when the listing is not configured', async () => {
  const app = buildApp({});
  const response = await app.inject({ method: 'GET', url: '/assets' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().reason, 'assets_unavailable');
  await app.close();
});

test('createAssetCatalogFromEnv needs the token and RPC and rejects bad addresses', () => {
  const chain = fakeChain(tokenContracts()) as never;
  assert.deepEqual(createAssetCatalogFromEnv({}, undefined), {
    disabled: 'TOKEN_ADDRESS and AMOY_RPC_URL are required',
  });
  assert.deepEqual(createAssetCatalogFromEnv({ TOKEN_ADDRESS: TOKEN, HOLDER_COUNT_MODULE_ADDRESS: 'nope' }, chain), {
    disabled: 'HOLDER_COUNT_MODULE_ADDRESS is not an address',
  });
  assert.ok('catalog' in createAssetCatalogFromEnv({ TOKEN_ADDRESS: TOKEN }, chain));
});
