import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { ONE_SHARE } from '../config/eqowa';
import { deployEqowaSuiteFixture } from './fixtures/deployEqowaSuite';

const NOT_AGENT = 'AgentRole: caller does not have the Agent role';
const NOT_OWNER = 'Ownable: caller is not the owner';

describe('role boundaries', () => {
  describe('AGENT_ROLE', () => {
    it('lets the agent mint, freeze, burn and register identities', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).setAddressFrozen(accounts.alice.address, true);
      await suite.token.connect(accounts.tokenAgent).setAddressFrozen(accounts.alice.address, false);
      await suite.token.connect(accounts.tokenAgent).burn(accounts.alice.address, ONE_SHARE);

      expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(0n);
    });

    it('rejects mint, burn, freeze and pause from anyone else', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await expect(suite.token.connect(accounts.outsider).mint(accounts.alice.address, ONE_SHARE)).to.be.revertedWith(
        NOT_AGENT,
      );
      await expect(suite.token.connect(accounts.alice).mint(accounts.alice.address, ONE_SHARE)).to.be.revertedWith(
        NOT_AGENT,
      );
      await expect(suite.token.connect(accounts.safe).mint(accounts.alice.address, ONE_SHARE)).to.be.revertedWith(
        NOT_AGENT,
      );
      await expect(suite.token.connect(accounts.outsider).burn(accounts.alice.address, ONE_SHARE)).to.be.revertedWith(
        NOT_AGENT,
      );
      await expect(
        suite.token.connect(accounts.outsider).setAddressFrozen(accounts.alice.address, true),
      ).to.be.revertedWith(NOT_AGENT);
      await expect(suite.token.connect(accounts.outsider).pause()).to.be.revertedWith(NOT_AGENT);
    });

    it('rejects identity registration from anyone but the agent', async () => {
      const { accounts, suite, identities } = await loadFixture(deployEqowaSuiteFixture);

      await expect(
        suite.identityRegistry
          .connect(accounts.outsider)
          .registerIdentity(accounts.charlie.address, await identities.aliceIdentity.getAddress(), 566),
      ).to.be.revertedWith(NOT_AGENT);
    });
  });

  describe('OWNER_ROLE (the Safe)', () => {
    it('rejects ownership and compliance changes from the agent and from outsiders', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await expect(suite.token.connect(accounts.outsider).transferOwnership(accounts.outsider.address)).to.be.revertedWith(
        NOT_OWNER,
      );
      await expect(
        suite.token.connect(accounts.tokenAgent).transferOwnership(accounts.tokenAgent.address),
      ).to.be.revertedWith(NOT_OWNER);
      await expect(suite.compliance.connect(accounts.outsider).addModule(accounts.outsider.address)).to.be.revertedWith(
        NOT_OWNER,
      );
      await expect(
        suite.compliance.connect(accounts.tokenAgent).addModule(accounts.tokenAgent.address),
      ).to.be.revertedWith(NOT_OWNER);
    });

    it('rejects callModuleFunction from anyone but the Safe', async () => {
      const { accounts, suite, modules } = await loadFixture(deployEqowaSuiteFixture);
      const data = modules.maxBalanceModule.interface.encodeFunctionData('setMaxBalance', [1n]);
      const moduleAddress = await modules.maxBalanceModule.getAddress();

      await expect(
        suite.compliance.connect(accounts.outsider).callModuleFunction(data, moduleAddress),
      ).to.be.revertedWith(NOT_OWNER);
      await expect(
        suite.compliance.connect(accounts.tokenAgent).callModuleFunction(data, moduleAddress),
      ).to.be.revertedWith(NOT_OWNER);
    });

    it('rejects an implementation-authority upgrade from anyone but its owner', async () => {
      const { accounts, infrastructure } = await loadFixture(deployEqowaSuiteFixture);

      await expect(
        infrastructure.trexImplementationAuthority.connect(accounts.outsider).useTREXVersion({
          major: 4,
          minor: 1,
          patch: 6,
        }),
      ).to.be.revertedWith(NOT_OWNER);

      await expect(
        infrastructure.trexImplementationAuthority.connect(accounts.safe).useTREXVersion({
          major: 4,
          minor: 1,
          patch: 6,
        }),
      ).to.be.revertedWith(NOT_OWNER);
    });
  });
});
