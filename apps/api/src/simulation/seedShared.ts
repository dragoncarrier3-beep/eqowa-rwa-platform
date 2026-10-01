import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { JsonRpcProvider } from 'ethers';

import { loadEnv } from '../bootstrap.ts';

import {
  HARDHAT_AGENT_ADDRESS,
  HARDHAT_AGENT_KEY,
  HARDHAT_OPERATOR_KEY,
  HARDHAT_SAFE_ADDRESS,
  REPO_ROOT,
  loadDeployment,
  type SimNetwork,
} from './context.ts';
import { simulate } from './run.ts';

/**
 * Sets up the shared test chain (deploy/README.md): deploys the suite and the
 * settlement contracts onto Anvil with the production scripts, runs the
 * lifecycle simulation so the portal has holders, a frozen wallet and a
 * refund to show, and writes the addresses the API needs to STATE_DIR.
 *
 * Safe to run again: when the recorded token still has code the deploy is
 * skipped and only the env file is rewritten. A reset chain is deployed anew.
 * Only ever run against a test chain; the keys it uses are public.
 */
const RPC = process.env.SIM_RPC_URL ?? 'http://127.0.0.1:8545';
// SEED_NETWORK=localhost rehearses the seed against a local Hardhat node.
const NETWORK: SimNetwork = process.env.SEED_NETWORK === 'localhost' ? 'localhost' : 'shared';
const STATE_DIR = process.env.STATE_DIR ?? path.join(REPO_ROOT, 'deploy', 'state');
const RECORD = path.join(REPO_ROOT, 'deployments', `${NETWORK}.json`);
const SAVED_RECORD = path.join(STATE_DIR, `${NETWORK}.json`);
const TEST_CHAIN_ID = 31337n;

function hardhatRun(script: string) {
  const result = spawnSync('npx', ['hardhat', 'run', script, '--network', NETWORK], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      SHARED_RPC_URL: RPC,
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

async function alreadyDeployed(provider: JsonRpcProvider) {
  if (!existsSync(RECORD) && existsSync(SAVED_RECORD)) {
    await mkdir(path.dirname(RECORD), { recursive: true });
    await copyFile(SAVED_RECORD, RECORD);
  }
  if (!existsSync(RECORD)) {
    return false;
  }
  try {
    const deployment = await loadDeployment(NETWORK);
    return (await provider.getCode(deployment.token)) !== '0x';
  } catch {
    return false;
  }
}

async function main() {
  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== TEST_CHAIN_ID) {
    throw new Error(`Chain ${chainId} is not the test chain (${TEST_CHAIN_ID}). Refusing to seed.`);
  }

  if (await alreadyDeployed(provider)) {
    console.log('Suite already on the chain, keeping it.');
  } else {
    hardhatRun('scripts/deploy.ts');
    hardhatRun('scripts/deploySettlement.ts');
    if (process.env.SEED_SIMULATE !== 'off') {
      const result = await simulate(NETWORK);
      if (result.failed > 0) {
        throw new Error(`${result.failed} simulation steps failed`);
      }
    }
  }

  const deployment = await loadDeployment(NETWORK);
  // The settlement worker starts after the simulation's own deposits, which
  // it already settled in memory; the token indexer reads from the start so
  // the holders the simulation created show in the portal.
  const head = await provider.getBlockNumber();
  const env = {
    CHAIN_ID: String(TEST_CHAIN_ID),
    TOKEN_ADDRESS: deployment.token,
    USDT_ADDRESS: deployment.settlement.usdt,
    ESCROW_ADDRESS: deployment.settlement.escrow,
    FORWARDER_ADDRESS: deployment.settlement.forwarder,
    GNOSIS_SAFE_ADDRESS: deployment.safe,
    IDENTITY_REGISTRY_ADDRESS: deployment.identityRegistry,
    IDENTITY_IMPLEMENTATION_AUTHORITY_ADDRESS: deployment.identityImplementationAuthority,
    CLAIM_ISSUER_ADDRESS: deployment.claimIssuer,
    COUNTRY_ALLOWLIST_MODULE_ADDRESS: deployment.modules.countryAllowlist,
    BALANCE_CAP_MODULE_ADDRESS: deployment.modules.balanceCap ?? '',
    HOLDER_COUNT_MODULE_ADDRESS: deployment.modules.holderCountCap ?? '',
    TIME_LOCKUP_MODULE_ADDRESS: deployment.modules.timeLockup,
    DAILY_MINT_CAP_MODULE_ADDRESS: deployment.modules.dailyMintCap ?? '',
    INDEX_FROM_BLOCK: process.env.INDEX_FROM_BLOCK_OVERRIDE ?? String(head + 1),
    TOKEN_INDEX_FROM_BLOCK: '1',
    // Public Hardhat/Anvil test keys: the deployer is the ClaimIssuer
    // management key, so it may sign claims; account #2 is the agent.
    AGENT_SIGNER_PRIVATE_KEY: HARDHAT_AGENT_KEY,
    RELAYER_PRIVATE_KEY: HARDHAT_AGENT_KEY,
    CLAIM_ISSUER_SIGNING_KEY: HARDHAT_OPERATOR_KEY,
  };

  await mkdir(STATE_DIR, { recursive: true });
  await copyFile(RECORD, SAVED_RECORD);
  const file = path.join(STATE_DIR, 'shared.env');
  const lines = [
    '# Written by the shared test chain seed. Test chain only; these keys are public.',
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
  ];
  await writeFile(file, `${lines.join('\n')}\n`);
  console.log(`Wrote ${file}. Restart the API to pick it up.`);
  provider.destroy();
}

loadEnv();
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
