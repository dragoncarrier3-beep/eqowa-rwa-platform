import { ethers } from 'hardhat';
import type { Provider } from 'ethers';

/**
 * Gas for the whole deploy: six T-REX implementations, ONCHAINID, the factory,
 * five modules behind proxies, `deployTREXSuite` and the unpause. Measured at
 * 40.76M against the local network on 10 September 2026.
 */
export const DEPLOY_GAS_ESTIMATE = 41_000_000n;

/** One `createProxyWithNonce` call against the Safe 1.4.1 factory. */
export const SAFE_CREATE_GAS_ESTIMATE = 400_000n;

/**
 * Amoy gas has swung between 25 and 80 gwei. The floor is computed from the
 * live price rather than hardcoded, then padded, because running out of gas
 * part way through leaves a half-deployed suite behind.
 */
export const SAFETY_MARGIN_PERCENT = 30n;

export async function requiredWei(provider: Provider, gasUnits: bigint): Promise<bigint> {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;

  if (!gasPrice) {
    throw new Error('Could not read a gas price from the network');
  }

  return (gasUnits * gasPrice * (100n + SAFETY_MARGIN_PERCENT)) / 100n;
}

export async function assertDeployerFunded(provider: Provider, deployer: string, gasUnits: bigint, label: string) {
  const [balance, needed] = await Promise.all([provider.getBalance(deployer), requiredWei(provider, gasUnits)]);

  if (balance < needed) {
    throw new Error(
      `${label} needs about ${ethers.formatEther(needed)} POL at the current gas price. ` +
        `Deployer has ${ethers.formatEther(balance)}.`,
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
