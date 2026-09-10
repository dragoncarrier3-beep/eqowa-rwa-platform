import { expect } from 'chai';
import { ethers } from 'hardhat';

import {
  MIN_DEPLOY_WEI,
  MIN_SAFE_CREATE_WEI,
  assertAmoyDeployReady,
  assertDeployerFunded,
  assertSafeDeployed,
} from '../../scripts/lib/amoyPreflight';

describe('Amoy deploy preflight', () => {
  it('rejects a Safe address that has no code', async () => {
    const [, empty] = await ethers.getSigners();

    await expect(assertSafeDeployed(ethers.provider, empty.address)).to.be.rejectedWith('has no code');
  });

  it('rejects a deployer below the POL floor', async () => {
    const [deployer] = await ethers.getSigners();

    await expect(
      assertDeployerFunded(ethers.provider, deployer.address, ethers.parseEther('1000000000'), 'deploy:amoy'),
    ).to.be.rejectedWith('needs at least');
  });

  it('passes when the Safe has code and the deployer is funded', async () => {
    const [deployer] = await ethers.getSigners();
    const placeholder = await ethers.deployContract('CountryAllowlistModule', [], deployer);

    await assertSafeDeployed(ethers.provider, await placeholder.getAddress());
    await assertDeployerFunded(ethers.provider, deployer.address, MIN_SAFE_CREATE_WEI, 'create-safe:amoy');
    await assertAmoyDeployReady(ethers.provider, deployer.address, await placeholder.getAddress());
  });

  it('keeps the documented POL floors', async () => {
    expect(MIN_SAFE_CREATE_WEI).to.equal(ethers.parseEther('0.05'));
    expect(MIN_DEPLOY_WEI).to.equal(ethers.parseEther('1.5'));
  });
});
