import { existsSync } from 'node:fs';

import { ethers, network } from 'hardhat';

import { networkByChainId } from '../config/networks';
import { deploymentPath, readDeployment } from './lib/deploymentFile';
import {
  checkAgent,
  checkClaimSigner,
  checkFunded,
  checkOwnedBySafe,
  checkSafe,
  checkUsdt,
  renderChecks,
  type PreflightCheck,
} from './lib/mainnetPreflight';

/**
 * npm run preflight:polygon
 *
 * Read-only. Run it before the mainnet deploy (USDT, Safe, gas money) and again
 * after the deploy and the ownership handover (roles, claim signer, owners).
 * Needs POLYGON_RPC_URL; no private key. Addresses come from .env:
 *   GNOSIS_SAFE_ADDRESS, AGENT_WALLET_ADDRESS, RELAYER_ADDRESS,
 *   DEPLOYER_ADDRESS_POLYGON, CLAIM_SIGNER_ADDRESS, MAINNET_SAFE_OWNERS (comma separated)
 * Exits 1 when any check fails.
 */
// The suite and settlement deploy is about 44M gas (docs/GAS.md); 10 POL covers
// it up to about 220 gwei. The agent and relayer pay for every mint and deposit.
const MIN_DEPLOYER_POL = ethers.parseEther('10');
const MIN_HOT_WALLET_POL = ethers.parseEther('5');

function envAddress(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not an address`);
  }
  return ethers.getAddress(value);
}

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const info = networkByChainId(Number(chainId));
  console.log(`Preflight on ${network.name} (chain ${chainId}${info ? `, ${info.name}` : ''}). Read-only.`);
  if (chainId !== 137n) {
    console.log('Not Polygon mainnet: this is a rehearsal.');
  }

  const provider = ethers.provider;
  const pol = (wei: bigint) => `${ethers.formatEther(wei)} POL`;
  const checks: PreflightCheck[] = [];

  const usdt = info?.usdtAddress ?? envAddress('USDT_ADDRESS');
  if (usdt) {
    checks.push(...(await checkUsdt(provider, usdt, chainId)));
  } else {
    checks.push({ name: 'USDT contract', ok: false, detail: 'no native USDT for this chain; set USDT_ADDRESS' });
  }

  const safe = envAddress('GNOSIS_SAFE_ADDRESS');
  const agent = envAddress('AGENT_WALLET_ADDRESS');
  const relayer = envAddress('RELAYER_ADDRESS');
  const deployer = envAddress('DEPLOYER_ADDRESS_POLYGON');
  const hotKeys: Record<string, string> = {};
  for (const [label, address] of [
    ['Agent wallet', agent],
    ['Relayer wallet', relayer],
    ['Deployer', deployer],
  ] as const) {
    if (address) {
      hotKeys[label] = address;
    }
  }

  if (safe) {
    const expectedOwners = (process.env.MAINNET_SAFE_OWNERS ?? '')
      .split(',')
      .map((owner) => owner.trim())
      .filter(Boolean);
    checks.push(...(await checkSafe(provider, safe, { expectedOwners, hotKeys })));
  } else {
    checks.push({ name: 'Gnosis Safe', ok: false, detail: 'set GNOSIS_SAFE_ADDRESS' });
  }

  if (deployer) {
    checks.push(await checkFunded(provider, 'Deployer', deployer, MIN_DEPLOYER_POL, pol));
  }
  if (agent) {
    checks.push(await checkFunded(provider, 'Agent wallet', agent, MIN_HOT_WALLET_POL, pol));
  }
  if (relayer && relayer !== agent) {
    checks.push(await checkFunded(provider, 'Relayer wallet', relayer, MIN_HOT_WALLET_POL, pol));
  }

  // After the deploy: the record exists and the roles must be in place.
  if (existsSync(deploymentPath(network.name))) {
    const deployment = await readDeployment(network.name);
    console.log(`Found ${deploymentPath(network.name)}, checking the deployed suite.`);
    checks.push(
      ...(await checkAgent(
        provider,
        { token: deployment.token, identityRegistry: deployment.identityRegistry },
        agent ?? deployment.agent,
      )),
    );
    const claimSigner = envAddress('CLAIM_SIGNER_ADDRESS');
    checks.push(
      claimSigner
        ? await checkClaimSigner(provider, deployment.claimIssuer, claimSigner)
        : { name: 'Claim signer on the ClaimIssuer', ok: false, detail: 'set CLAIM_SIGNER_ADDRESS' },
    );
    checks.push(
      ...(await checkOwnedBySafe(
        provider,
        {
          Token: deployment.token,
          'Identity registry': deployment.identityRegistry,
          Compliance: deployment.compliance,
          ...(deployment.settlement ? { Escrow: deployment.settlement.escrow } : {}),
        },
        deployment.safe,
      )),
    );
    if (safe && ethers.getAddress(deployment.safe) !== safe) {
      checks.push({ name: 'Deployment Safe', ok: false, detail: `record has ${deployment.safe}, .env has ${safe}` });
    }
  } else {
    console.log('No deployment record yet, so only the pre-deploy checks ran.');
  }

  console.log('');
  console.log(renderChecks(checks));
  const failed = checks.filter((check) => !check.ok).length;
  console.log('');
  console.log(failed === 0 ? `All ${checks.length} checks passed.` : `${failed} of ${checks.length} checks failed.`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
