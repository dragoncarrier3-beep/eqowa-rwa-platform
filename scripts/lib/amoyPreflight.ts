import { ethers } from 'hardhat';
import type { Provider } from 'ethers';

/** Floor for `create-safe:amoy`. The factory call is cheap; this is a buffer. */
export const MIN_SAFE_CREATE_WEI = ethers.parseEther('0.05');

/** Floor for `deploy:amoy`. The suite, five modules and unpause need headroom. */
export const MIN_DEPLOY_WEI = ethers.parseEther('1.5');

export async function assertDeployerFunded(provider: Provider, deployer: string, minWei: bigint, label: string) {
  const balance = await provider.getBalance(deployer);
  if (balance < minWei) {
    throw new Error(
      `${label} needs at least ${ethers.formatEther(minWei)} POL. Deployer has ${ethers.formatEther(balance)}.`,
    );
  }
}

export async function assertSafeDeployed(provider: Provider, safe: string) {
  const code = await provider.getCode(safe);
  if (code === '0x') {
    throw new Error(`GNOSIS_SAFE_ADDRESS ${safe} has no code. Run npm run create-safe:amoy first.`);
  }
}

/** Deployer has POL and the Amoy Safe already exists. */
export async function assertAmoyDeployReady(provider: Provider, deployer: string, safe: string) {
  await assertSafeDeployed(provider, safe);
  await assertDeployerFunded(provider, deployer, MIN_DEPLOY_WEI, 'deploy:amoy');
}
