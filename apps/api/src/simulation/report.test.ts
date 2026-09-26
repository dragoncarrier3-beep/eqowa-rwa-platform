import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMarkdown } from './report.ts';
import type { SimulationResult } from './scenario.ts';

const TX = `0x${'ab'.repeat(32)}`;

function sample(network: string, pass = true): SimulationResult {
  return {
    network,
    chainId: network === 'amoy' ? 80002 : 31337,
    runId: 'run-1',
    startedAt: '2026-09-26T12:00:00.000Z',
    finishedAt: '2026-09-26T12:05:00.000Z',
    contracts: { token: '0x1111111111111111111111111111111111111111' },
    wallets: { alice: '0x2222222222222222222222222222222222222222' },
    steps: [
      { id: 'S01', title: 'Preflight', expected: 'ok', actual: 'ok', pass: true, txs: [] },
      { id: 'S02', title: 'Mint | pipe', expected: 'minted', actual: pass ? 'minted' : 'quoted', pass, txs: [TX] },
    ],
    passed: pass ? 2 : 1,
    failed: pass ? 0 : 1,
  };
}

test('links transactions and addresses to Polygonscan on Amoy', () => {
  const markdown = renderMarkdown(sample('amoy'));

  assert.match(markdown, /All steps passed: 2 of 2/);
  assert.ok(markdown.includes(`https://amoy.polygonscan.com/tx/${TX}`));
  assert.ok(markdown.includes('https://amoy.polygonscan.com/address/0x1111111111111111111111111111111111111111'));
});

test('shows plain hashes locally and flags failures', () => {
  const markdown = renderMarkdown(sample('localhost', false));

  assert.match(markdown, /1 step\(s\) failed: 1 of 2/);
  assert.match(markdown, /S02 FAIL/);
  assert.ok(!markdown.includes('polygonscan'));
});

test('escapes table pipes so a result cannot break the table', () => {
  const markdown = renderMarkdown(sample('localhost'));

  assert.ok(markdown.includes('Mint \\| pipe'));
});
