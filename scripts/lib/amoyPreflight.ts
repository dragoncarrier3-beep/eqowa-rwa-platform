import { ethers } from 'hardhat';
import type { Provider } from 'ethers';

import { AMOY_GAS_PRICE_WEI } from '../../config/amoyFees';

/**
 * Gas for the whole deploy: six T-REX implementations, ONCHAINID, the factory,
 * five modules behind proxies, `deployTREXSuite` and the unpause. Measured at
 * 40.76M against the local network on 10 September 2026.
 */
export const DEPLOY_GAS_ESTIMATE = 41_000_000n;

/** One `createProxyWithNonce` call against the Safe 1.4.1 factory. */
export const SAFE_CREATE_GAS_ESTIMATE = 400_000n;

/**
 * Covers drift in the gas estimate only. The price side needs no margin
 * because it is pinned rather than quoted by the network.
 */
export const GAS_ESTIMATE_MARGIN_PERCENT = 15n;

/** Cost of `gasUnits` at the pinned Amoy gas price. */
export function requiredWei(gasUnits: bigint): bigint {
  return (gasUnits * AMOY_GAS_PRICE_WEI * (100n + GAS_ESTIMATE_MARGIN_PERCENT)) / 100n;
}

export async function assertDeployerFunded(provider: Provider, deployer: string, gasUnits: bigint, label: string) {
  const balance = await provider.getBalance(deployer);
  const needed = requiredWei(gasUnits);

  if (balance < needed) {
    throw new Error(
      `${label} needs about ${ethers.formatEther(needed)} POL. Deployer has ${ethers.formatEther(balance)}.`,
    );
  }
}

export async function assertSafeDeployed(provider: Provider, safe: string) {
  const code = await provider.getCode(safe);
  if (code === '0x') {
    throw new Error(`GNOSIS_SAFE_ADDRESS ${safe} has no code. Run npm run create-safe:amoy first.`);
  }
}

/** Deployer can pay for the whole deploy and the Amoy Safe already exists. */
export async function assertAmoyDeployReady(provider: Provider, deployer: string, safe: string) {
  await assertSafeDeployed(provider, safe);
  await assertDeployerFunded(provider, deployer, DEPLOY_GAS_ESTIMATE, 'deploy:amoy');
}
