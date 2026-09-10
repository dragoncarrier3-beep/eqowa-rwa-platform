import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { MAX_BALANCE, ONE_SHARE, TOKEN_DECIMALS, TOKEN_NAME, TOKEN_SYMBOL } from '../config/eqowa';
import { deployEqowaSuiteFixture } from './fixtures/deployEqowaSuite';

describe('EQOWAG suite deployment', () => {
  describe('token configuration', () => {
    it('deploys with the agreed name, symbol and decimals', async () => {
      const { suite } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.token.name()).to.equal(TOKEN_NAME);
      expect(await suite.token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await suite.token.decimals()).to.equal(TOKEN_DECIMALS);
    });

    it('starts with zero supply', async () => {
      const { suite } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.token.totalSupply()).to.equal(0n);
    });

    it('is unpaused and ready to transact', async () => {
      const { suite } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.token.paused()).to.be.false;
    });
  });

  describe('governance', () => {
    it('hands ownership of the token and registries to the Safe', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.token.owner()).to.equal(accounts.safe.address);
      expect(await suite.identityRegistry.owner()).to.equal(accounts.safe.address);
      expect(await suite.compliance.owner()).to.equal(accounts.safe.address);
      expect(await suite.claimTopicsRegistry.owner()).to.equal(accounts.safe.address);
      expect(await suite.trustedIssuersRegistry.owner()).to.equal(accounts.safe.address);
    });

    it('grants the agent wallet mint and registry rights', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.token.isAgent(accounts.tokenAgent.address)).to.be.true;
      expect(await suite.identityRegistry.isAgent(accounts.tokenAgent.address)).to.be.true;
    });
  });

  describe('compliance wiring', () => {
    it('binds both Phase 1 modules to the compliance', async () => {
      const { suite, modules } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.compliance.isModuleBound(await modules.countryAllowModule.getAddress())).to.be.true;
      expect(await suite.compliance.isModuleBound(await modules.maxBalanceModule.getAddress())).to.be.true;
    });

    it('applies the module settings passed at deployment', async () => {
      const { suite, modules } = await loadFixture(deployEqowaSuiteFixture);

      const complianceAddress = await suite.compliance.getAddress();

      expect(await modules.countryAllowModule.isCountryAllowed(complianceAddress, 566)).to.be.true; // Nigeria
      expect(await modules.countryAllowModule.isCountryAllowed(complianceAddress, 840)).to.be.false; // United States
      expect(await modules.maxBalanceModule.getMaxBalance(complianceAddress)).to.equal(MAX_BALANCE);
    });
  });

  describe('identity verification', () => {
    it('recognises investors holding both required claims', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.identityRegistry.isVerified(accounts.alice.address)).to.be.true;
      expect(await suite.identityRegistry.isVerified(accounts.bob.address)).to.be.true;
    });

    it('does not recognise a wallet with no identity', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      expect(await suite.identityRegistry.isVerified(accounts.charlie.address)).to.be.false;
    });
  });

  describe('end to end transfer', () => {
    it('lets a verified investor transfer to another verified investor', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);
      const amount = 1_000n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(amount);

      const transferred = 250n * ONE_SHARE;
      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, transferred);

      expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(amount - transferred);
      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(transferred);
    });

    it('blocks minting to a wallet with no identity', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.charlie.address, ONE_SHARE),
      ).to.be.revertedWith('Identity is not verified.');
    });

    it('blocks a transfer that would breach the per-identity balance cap', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, MAX_BALANCE + ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });
  });
});
