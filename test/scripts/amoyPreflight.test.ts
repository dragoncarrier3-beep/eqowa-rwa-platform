import { expect } from 'chai';
import { ethers } from 'hardhat';

import {
  DEPLOY_GAS_ESTIMATE,
  SAFE_CREATE_GAS_ESTIMATE,
  assertAmoyDeployReady,
  assertDeployerFunded,
  assertSafeDeployed,
  requiredWei,
} from '../../scripts/lib/amoyPreflight';

describe('Amoy deploy preflight', () => {
  it('rejects a Safe address that has no code', async () => {
    const [, empty] = await ethers.getSigners();

    await expect(assertSafeDeployed(ethers.provider, empty.address)).to.be.rejectedWith('has no code');
  });

  it('prices the deploy from the live gas price, with a margin', async () => {
    const feeData = await ethers.provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const needed = await requiredWei(ethers.provider, DEPLOY_GAS_ESTIMATE);

    expect(needed).to.equal((DEPLOY_GAS_ESTIMATE * gasPrice * 130n) / 100n);
  });

  it('rejects a deployer that cannot cover the deploy', async () => {
    const [deployer] = await ethers.getSigners();

    await expect(
      assertDeployerFunded(ethers.provider, deployer.address, DEPLOY_GAS_ESTIMATE * 10n ** 12n, 'deploy:amoy'),
    ).to.be.rejectedWith('needs about');
  });

  it('passes when the Safe has code and the deployer is funded', async () => {
    const [deployer] = await ethers.getSigners();
    const placeholder = await ethers.deployContract('CountryAllowlistModule', [], deployer);

    await assertSafeDeployed(ethers.provider, await placeholder.getAddress());
    await assertDeployerFunded(ethers.provider, deployer.address, SAFE_CREATE_GAS_ESTIMATE, 'create-safe:amoy');
    await assertAmoyDeployReady(ethers.provider, deployer.address, await placeholder.getAddress());
  });

  it('keeps the measured gas estimate for the full suite', async () => {
    // Measured at 40,757,565 gas locally. Raise this if the suite grows.
    expect(DEPLOY_GAS_ESTIMATE).to.equal(41_000_000n);
  });
});
