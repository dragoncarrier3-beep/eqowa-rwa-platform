import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { COUNTRY, ONE_SHARE } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

const DEFAULT_CAP = 2n;

async function deployModule(deployer: Awaited<ReturnType<typeof ethers.getSigners>>[number]) {
  const implementation = await ethers.deployContract('HolderCountCapModule', [], deployer);
  const proxy = await ethers.deployContract(
    'ModuleProxy',
    [await implementation.getAddress(), implementation.interface.encodeFunctionData('initialize')],
    deployer,
  );

  return ethers.getContractAt('HolderCountCapModule', await proxy.getAddress());
}

/** Suite fixture with the holder cap module bound and a cap of two. */
async function deployWithHolderCountCap() {
  const context = await loadFixture(deployEqowaSuiteFixture);
  const holderCountCapModule = await deployModule(context.accounts.deployer);
  const moduleAddress = await holderCountCapModule.getAddress();

  await context.suite.compliance.connect(context.accounts.safe).addModule(moduleAddress);
  await context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      holderCountCapModule.interface.encodeFunctionData('setMaxHolderCount', [DEFAULT_CAP]),
      moduleAddress,
    );

  return { ...context, holderCountCapModule };
}

type Context = Awaited<ReturnType<typeof deployWithHolderCountCap>>;

/** Changes the cap the way the Safe would, through the compliance contract. */
async function setCap(context: Context, cap: bigint) {
  const moduleAddress = await context.holderCountCapModule.getAddress();

  await context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      context.holderCountCapModule.interface.encodeFunctionData('setMaxHolderCount', [cap]),
      moduleAddress,
    );
}

describe('HolderCountCapModule', () => {
  describe('wiring', () => {
    it('binds to the compliance and reports its name', async () => {
      const { suite, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);

      expect(await suite.compliance.isModuleBound(await holderCountCapModule.getAddress())).to.be.true;
      expect(await holderCountCapModule.name()).to.equal('HolderCountCapModule');
      expect(await holderCountCapModule.isPlugAndPlay()).to.be.false;
    });

    it('exposes the cap set at binding time', async () => {
      const { suite, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);

      expect(await holderCountCapModule.getMaxHolderCount(await suite.compliance.getAddress())).to.equal(DEFAULT_CAP);
    });

    it('refuses to bind to a compliance whose token already has supply', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite } = context;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE);

      const freshModule = await deployModule(accounts.deployer);
      expect(await freshModule.canComplianceBind(await suite.compliance.getAddress())).to.be.false;
    });
  });

  describe('access control', () => {
    it('rejects setMaxHolderCount called directly rather than through the compliance', async () => {
      const { accounts, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);

      await expect(holderCountCapModule.connect(accounts.safe).setMaxHolderCount(10n)).to.be.revertedWith(
        'only bound compliance can call',
      );
    });

    it('rejects module actions from anyone but the bound compliance', async () => {
      const { accounts, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);

      await expect(
        holderCountCapModule.connect(accounts.outsider).moduleMintAction(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWith('only bound compliance can call');
    });
  });

  describe('counting holders', () => {
    it('counts a minted investor as one holder', async () => {
      const { accounts, suite, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);
      const complianceAddress = await suite.compliance.getAddress();

      expect(await holderCountCapModule.getHolderCount(complianceAddress)).to.equal(0n);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);

      expect(await holderCountCapModule.getHolderCount(complianceAddress)).to.equal(1n);
    });

    it('counts each investor separately', async () => {
      const { accounts, suite, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, 100n * ONE_SHARE);

      expect(await holderCountCapModule.getHolderCount(await suite.compliance.getAddress())).to.equal(2n);
    });

    it('counts two wallets of the same investor as a single holder', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite, identities, holderCountCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();

      // Give alice a second wallet backed by the same ONCHAINID.
      await suite.identityRegistry
        .connect(accounts.tokenAgent)
        .registerIdentity(accounts.outsider.address, await identities.aliceIdentity.getAddress(), COUNTRY.NIGERIA);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);
      expect(await holderCountCapModule.getHolderCount(complianceAddress)).to.equal(1n);

      await suite.token.connect(accounts.alice).transfer(accounts.outsider.address, 40n * ONE_SHARE);

      expect(await holderCountCapModule.getHolderCount(complianceAddress)).to.equal(1n);
      expect(await suite.token.balanceOf(accounts.outsider.address)).to.equal(40n * ONE_SHARE);
    });

    it('drops a holder whose balance falls to zero on transfer', async () => {
      const { accounts, suite, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);
      const complianceAddress = await suite.compliance.getAddress();
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, amount);

      expect(await holderCountCapModule.getHolderCount(complianceAddress)).to.equal(1n);
      expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(0n);
    });

    it('drops a holder whose balance is burned to zero', async () => {
      const { accounts, suite, holderCountCapModule } = await loadFixture(deployWithHolderCountCap);
      const complianceAddress = await suite.compliance.getAddress();
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await suite.token.connect(accounts.tokenAgent).burn(accounts.alice.address, amount);

      expect(await holderCountCapModule.getHolderCount(complianceAddress)).to.equal(0n);
    });
  });

  describe('enforcing the cap', () => {
    it('blocks a mint that would exceed the cap', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite } = context;
      await setCap(context, 1n);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, 100n * ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('allows topping up an existing holder once the cap is reached', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite } = context;
      await setCap(context, 1n);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 50n * ONE_SHARE);

      expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(150n * ONE_SHARE);
    });

    it('allows a full-balance transfer at the cap, because the sender frees a slot', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite, holderCountCapModule } = context;
      await setCap(context, 1n);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, amount);

      expect(await holderCountCapModule.getHolderCount(await suite.compliance.getAddress())).to.equal(1n);
      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(amount);
    });

    it('blocks a partial transfer at the cap, because it would add a holder', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite } = context;
      await setCap(context, 1n);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.bob.address, 40n * ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');
    });

    it('blocks every mint when the cap is left at zero', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite } = context;
      await setCap(context, 0n);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('lets the Safe raise the cap to admit more holders', async () => {
      const context = await loadFixture(deployWithHolderCountCap);
      const { accounts, suite, holderCountCapModule } = context;
      await setCap(context, 1n);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);
      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, 100n * ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');

      await setCap(context, 2n);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, 100n * ONE_SHARE);

      expect(await holderCountCapModule.getHolderCount(await suite.compliance.getAddress())).to.equal(2n);
    });
  });
});
