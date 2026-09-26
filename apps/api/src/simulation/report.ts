import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AMOY_EXPLORER, REPO_ROOT } from './context.ts';
import { SIMULATED_SAFE_TX, type SimulationResult } from './scenario.ts';

function cell(text: string) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function txLink(network: string, hash: string) {
  return network === 'amoy' ? `[${shortHash(hash)}](${AMOY_EXPLORER}/tx/${hash})` : `\`${shortHash(hash)}\``;
}

function addressCell(network: string, address: string) {
  return network === 'amoy' ? `[${address}](${AMOY_EXPLORER}/address/${address})` : `\`${address}\``;
}

/** Markdown evidence report for one run. Addresses and hashes only, never keys. */
export function renderMarkdown(result: SimulationResult): string {
  const verdict = result.failed === 0 ? 'All steps passed' : `${result.failed} step(s) failed`;
  const lines = [
    `# EQOWAG lifecycle simulation, ${result.network}`,
    '',
    `${verdict}: ${result.passed} of ${result.steps.length}.`,
    '',
    `- Chain id: ${result.chainId}`,
    `- Started: ${result.startedAt}`,
    `- Finished: ${result.finishedAt}`,
    `- Run id: ${result.runId}`,
    '',
    'Runs the production Sumsub webhook handler, payment-to-mint pipeline, settlement worker and',
    'agent mint executor against the deployed contracts. Sumsub itself is replaced by GREEN review',
    'payloads, and the Safe approval uses a labelled placeholder hash',
    `(\`${SIMULATED_SAFE_TX}\`), because signing a Safe transaction is not part of this run.`,
    '',
    '## Contracts',
    '',
    '| Contract | Address |',
    '| --- | --- |',
    ...Object.entries(result.contracts).map(
      ([name, address]) => `| ${name} | ${addressCell(result.network, address)} |`,
    ),
    '',
    '## Wallets',
    '',
    '| Role | Address |',
    '| --- | --- |',
    ...Object.entries(result.wallets).map(([name, address]) => `| ${name} | ${addressCell(result.network, address)} |`),
    '',
    '## Steps',
    '',
    '| Step | What | Expected | Result | Evidence |',
    '| --- | --- | --- | --- | --- |',
    ...result.steps.map((item) => {
      const evidence =
        item.txs.length > 0 ? item.txs.map((hash) => txLink(result.network, hash)).join('<br>') : 'read-only';
      return `| ${item.id} ${item.pass ? 'PASS' : 'FAIL'} | ${cell(item.title)} | ${cell(item.expected)} | ${cell(item.actual)} | ${evidence} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

/** Writes reports/<network>-<timestamp>.{json,md} and returns the paths. */
export async function writeReport(result: SimulationResult, dir: string = path.join(REPO_ROOT, 'reports')) {
  await mkdir(dir, { recursive: true });
  const stamp = result.startedAt.replace(/[:.]/g, '-');
  const base = path.join(dir, `${result.network}-${stamp}`);
  await writeFile(`${base}.json`, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(`${base}.md`, renderMarkdown(result));
  return { json: `${base}.json`, markdown: `${base}.md` };
}
