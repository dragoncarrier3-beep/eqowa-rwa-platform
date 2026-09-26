import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

import { JsonRpcProvider } from 'ethers';

import { HARDHAT_AGENT_ADDRESS, HARDHAT_SAFE_ADDRESS, REPO_ROOT } from './context.ts';
import { simulate } from './run.ts';

/**
 * One command for the whole local run: start a Hardhat node, deploy the suite
 * and the settlement contracts with the production scripts, simulate, stop.
 * CI runs this on every pull request.
 */
const RPC = 'http://127.0.0.1:8545';

function stop(node: ChildProcess) {
  if (!node.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(node.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-node.pid, 'SIGTERM');
    } catch {
      node.kill('SIGTERM');
    }
  }
}

async function waitForNode() {
  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await provider.getBlockNumber();
      provider.destroy();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  provider.destroy();
  throw new Error(`Hardhat node did not answer on ${RPC}`);
}

function hardhatRun(script: string) {
  const result = spawnSync('npx', ['hardhat', 'run', script, '--network', 'localhost'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      GNOSIS_SAFE_ADDRESS: HARDHAT_SAFE_ADDRESS,
      AGENT_WALLET_ADDRESS: HARDHAT_AGENT_ADDRESS,
      CLAIM_ISSUER_ADDRESS: '',
      FORCE_SETTLEMENT_DEPLOY: '',
    },
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed`);
  }
}

async function main() {
  const node = spawn('npx', ['hardhat', 'node'], {
    cwd: REPO_ROOT,
    shell: true,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  try {
    await waitForNode();
    hardhatRun('scripts/deploy.ts');
    hardhatRun('scripts/deploySettlement.ts');
    const result = await simulate('localhost');
    process.exitCode = result.failed === 0 ? 0 : 1;
  } finally {
    stop(node);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
