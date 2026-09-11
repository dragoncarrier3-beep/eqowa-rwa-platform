import { expect } from 'chai';
import { ethers } from 'hardhat';

import { AMOY_GAS_PRICE_GWEI } from '../../config/amoyFees';
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

  it('prices the deploy under two POL at the pinned gas price', () => {
    const needed = requiredWei(DEPLOY_GAS_ESTIMATE);

    expect(needed).to.equal((DEPLOY_GAS_ESTIMATE * AMOY_GAS_PRICE_GWEI * 10n ** 9n * 115n) / 100n);
    expect(needed).to.be.lessThan(ethers.parseEther('2'));
  });

  it('stays above the 25 gwei floor Bor enforces', () => {
    expect(AMOY_GAS_PRICE_GWEI).to.be.greaterThan(25n);
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

  it('keeps the measured gas estimate for the full suite', () => {
    // Measured at 40,757,565 gas locally. Raise this if the suite grows.
    expect(DEPLOY_GAS_ESTIMATE).to.equal(41_000_000n);
  });
});
