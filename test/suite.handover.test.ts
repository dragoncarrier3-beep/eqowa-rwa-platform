import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { DAILY_MINT_CAP, LOCKUP_DURATION_SECONDS, MAX_BALANCE, MAX_HOLDER_COUNT } from '../config/eqowa';
import { deployEqowaContracts } from '../scripts/lib/deployEqowaContracts';
import { assertDeployerHasNoAdmin, handoverOwnership, type HandoverTargets } from '../scripts/lib/handoverOwnership';

const NOT_AGENT = 'AgentRole: caller does not have the Agent role';
const NOT_OWNER = 'Ownable: caller is not the owner';

async function deployProductionPath() {
  const [deployer, safe, agent, claimIssuer] = await ethers.getSigners();
  const claimIssuerContract = await ethers.deployContract('ClaimIssuer', [claimIssuer.address], claimIssuer);

  const suite = await deployEqowaContracts({
    deployer,
    owner: deployer.address,
    agent: agent.address,
    claimIssuer: await claimIssuerContract.getAddress(),
    includeDeployerAsAgent: true,
  });

  await suite.token.connect(deployer).unpause();

  const targets: HandoverTargets = {
    safe: safe.address,
    agent: agent.address,
    deployer: deployer.address,
    token: await suite.token.getAddress(),
    identityRegistry: await suite.identityRegistry.getAddress(),
    identityRegistryStorage: await suite.identityRegistryStorage.getAddress(),
    compliance: await suite.compliance.getAddress(),
    claimTopicsRegistry: await suite.claimTopicsRegistry.getAddress(),
    trustedIssuersRegistry: await suite.trustedIssuersRegistry.getAddress(),
    trexFactory: await suite.trexFactory.getAddress(),
    trexImplementationAuthority: await suite.trexImplementationAuthority.getAddress(),
    identityFactory: await suite.identityFactory.getAddress(),
    identityImplementationAuthority: await suite.identityImplementationAuthority.getAddress(),
    modules: [
      await suite.countryAllowModule.getAddress(),
      await suite.maxBalanceModule.getAddress(),
      await suite.holderCountCapModule.getAddress(),
      await suite.timeLockupModule.getAddress(),
      await suite.dailyMintCapModule.getAddress(),
    ],
  };

  return { accounts: { deployer, safe, agent }, suite, targets };
}

async function deployAndHandover() {
  const context = await deployProductionPath();
  await handoverOwnership(context.targets, context.accounts.deployer);
  return context;
}

describe('production deploy and handover', () => {
  describe('before ownership moves', () => {
    it('keeps the deployer as a temporary agent so it can unpause', async () => {
      const { accounts, suite } = await loadFixture(deployProductionPath);

      expect(await suite.token.owner()).to.equal(accounts.deployer.address);
      expect(await suite.token.isAgent(accounts.deployer.address)).to.be.true;
      expect(await suite.token.isAgent(accounts.agent.address)).to.be.true;
      expect(await suite.token.paused()).to.be.false;
    });

    it('leaves IdentityRegistryStorage with the factory', async () => {
      const { suite } = await loadFixture(deployProductionPath);

      expect(await suite.identityRegistryStorage.owner()).to.equal(await suite.trexFactory.getAddress());
    });

    it('binds all five modules with the production settings', async () => {
      const { suite } = await loadFixture(deployProductionPath);
      const complianceAddress = await suite.compliance.getAddress();

      expect(await suite.compliance.isModuleBound(await suite.countryAllowModule.getAddress())).to.be.true;
      expect(await suite.maxBalanceModule.getMaxBalance(complianceAddress)).to.equal(MAX_BALANCE);
      expect(await suite.holderCountCapModule.getMaxHolderCount(complianceAddress)).to.equal(MAX_HOLDER_COUNT);
      expect(await suite.timeLockupModule.getLockupDuration(complianceAddress)).to.equal(LOCKUP_DURATION_SECONDS);
      expect(await suite.dailyMintCapModule.getDailyMintCap(complianceAddress)).to.equal(DAILY_MINT_CAP);
    });

    it('refuses to assert a clean handover while the deployer still owns the suite', async () => {
      const { targets } = await loadFixture(deployProductionPath);

      await expect(assertDeployerHasNoAdmin(targets)).to.be.rejectedWith('Deployer still owns');
    });
  });

  describe('after handover', () => {
    it('moves every admin right to the Safe and strips the deployer', async () => {
      const { targets } = await loadFixture(deployAndHandover);

      await assertDeployerHasNoAdmin(targets);
    });

    it('recovers IdentityRegistryStorage from the factory onto the Safe', async () => {
      const { accounts, suite } = await loadFixture(deployAndHandover);

      expect(await suite.identityRegistryStorage.owner()).to.equal(accounts.safe.address);
    });

    it('rejects mint and ownership changes from the deployer', async () => {
      const { accounts, suite } = await loadFixture(deployAndHandover);

      await expect(suite.token.connect(accounts.deployer).mint(accounts.agent.address, 1n)).to.be.revertedWith(
        NOT_AGENT,
      );
      await expect(
        suite.token.connect(accounts.deployer).transferOwnership(accounts.deployer.address),
      ).to.be.revertedWith(NOT_OWNER);
      await expect(suite.token.connect(accounts.deployer).addAgent(accounts.deployer.address)).to.be.revertedWith(
        NOT_OWNER,
      );
    });

    it('lets the Safe, and only the Safe, drive the implementation authority', async () => {
      const { accounts, suite } = await loadFixture(deployAndHandover);
      const version = { major: 4, minor: 1, patch: 6 };

      expect(await suite.trexImplementationAuthority.owner()).to.equal(accounts.safe.address);

      await expect(
        suite.trexImplementationAuthority.connect(accounts.deployer).useTREXVersion(version),
      ).to.be.revertedWith(NOT_OWNER);
      await expect(suite.trexImplementationAuthority.connect(accounts.safe).useTREXVersion(version)).to.be.revertedWith(
        'version already in use',
      );
    });
  });
});
