import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { buildApp } from '../index.ts';

import { RPC_MAX_BATCH, registerRpcProxy } from './proxy.ts';

type Sent = { url: string; body: { id: unknown; method: string }[] };

function fakeNode() {
  const sent: Sent[] = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: unknown; method: string }[];
    sent.push({ url: String(url), body });
    // Answer in reverse order, as a node is allowed to.
    return Response.json(body.map((call) => ({ jsonrpc: '2.0', id: call.id, result: `${call.method}-ok` })).reverse());
  }) as typeof fetch;
  const app = Fastify();
  registerRpcProxy(app, { upstream: 'http://anvil:8545', fetch: fetchStub });
  return { app, sent };
}

test('forwards allowed methods and keeps single-call and batch shapes', async () => {
  const { app, sent } = fakeNode();
  const single = await app.inject({
    method: 'POST',
    url: '/rpc',
    payload: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
  });
  assert.equal(single.statusCode, 200);
  assert.deepEqual(single.json(), { jsonrpc: '2.0', id: 1, result: 'eth_chainId-ok' });
  assert.equal(single.headers['access-control-allow-origin'], '*');
  assert.equal(sent[0].url, 'http://anvil:8545');

  const batch = await app.inject({
    method: 'POST',
    url: '/rpc',
    payload: [
      { jsonrpc: '2.0', id: 'a', method: 'eth_blockNumber' },
      { jsonrpc: '2.0', id: 'b', method: 'eth_sendRawTransaction', params: ['0x02'] },
    ],
  });
  assert.deepEqual(
    batch.json().map((answer: { id: string; result: string }) => [answer.id, answer.result]),
    [
      ['a', 'eth_blockNumber-ok'],
      ['b', 'eth_sendRawTransaction-ok'],
    ],
  );
});

test('refuses methods that spend unlocked accounts or rewrite the chain, without calling the node', async () => {
  const { app, sent } = fakeNode();
  for (const method of [
    'eth_sendTransaction',
    'eth_sign',
    'anvil_setBalance',
    'hardhat_mine',
    'evm_revert',
    'debug_traceCall',
  ]) {
    const response = await app.inject({ method: 'POST', url: '/rpc', payload: { jsonrpc: '2.0', id: 7, method } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().error.code, -32601, method);
    assert.equal(response.json().id, 7);
  }
  assert.equal(sent.length, 0);
});

test('a batch forwards only its allowed calls and answers the rest with errors in place', async () => {
  const { app, sent } = fakeNode();
  const response = await app.inject({
    method: 'POST',
    url: '/rpc',
    payload: [
      { jsonrpc: '2.0', id: 1, method: 'anvil_mine' },
      { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: ['0x0', 'latest'] },
      { jsonrpc: '2.0', id: 3 },
    ],
  });
  const [refused, allowed, invalid] = response.json();
  assert.equal(refused.error.code, -32601);
  assert.equal(allowed.result, 'eth_getBalance-ok');
  assert.equal(invalid.error.code, -32600);
  assert.deepEqual(
    sent[0].body.map((call) => call.method),
    ['eth_getBalance'],
  );
});

test('rejects empty and oversized batches, and reports an unreachable node', async () => {
  const { app } = fakeNode();
  assert.equal((await app.inject({ method: 'POST', url: '/rpc', payload: [] })).statusCode, 400);
  const tooMany = Array.from({ length: RPC_MAX_BATCH + 1 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'eth_chainId' }));
  assert.equal((await app.inject({ method: 'POST', url: '/rpc', payload: tooMany })).statusCode, 400);

  const down = Fastify();
  registerRpcProxy(down, {
    upstream: 'http://anvil:8545',
    fetch: (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch,
  });
  const response = await down.inject({
    method: 'POST',
    url: '/rpc',
    payload: { jsonrpc: '2.0', id: 1, method: 'eth_chainId' },
  });
  assert.equal(response.json().error.code, -32603);

  const preflight = await app.inject({ method: 'OPTIONS', url: '/rpc' });
  assert.equal(preflight.statusCode, 204);
});

test('the API serves /rpc only when an upstream node is configured', async () => {
  const off = buildApp({});
  assert.equal(
    (await off.inject({ method: 'POST', url: '/rpc', payload: { id: 1, method: 'eth_chainId' } })).statusCode,
    404,
  );

  const on = buildApp({
    rpcProxy: {
      upstream: 'http://anvil:8545',
      fetch: (async () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x7a69' })) as typeof fetch,
    },
  });
  const response = await on.inject({
    method: 'POST',
    url: '/rpc',
    payload: { jsonrpc: '2.0', id: 1, method: 'eth_chainId' },
  });
  assert.equal(response.json().result, '0x7a69');
});
