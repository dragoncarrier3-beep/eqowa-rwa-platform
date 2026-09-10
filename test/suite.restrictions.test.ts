import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

import { DAILY_MINT_CAP, LOCKUP_DURATION_SECONDS, MAX_BALANCE, ONE_SHARE } from '../config/eqowa';
import { deployEqowaSuiteFixture } from './fixtures/deployEqowaSuite';
import { deployFullRulesFixture } from './fixtures/deployFullRules';

const LOCKUP = Number(LOCKUP_DURATION_SECONDS);

describe('transfer restrictions', () => {
  describe('identity and country', () => {
    it('blocks a transfer to a wallet with no identity', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 10n * ONE_SHARE);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.charlie.address, ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');
    });

    it('blocks a transfer to a verified investor in a blocked country', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 10n * ONE_SHARE);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.david.address, ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');
    });
  });

  describe('freeze and pause', () => {
    it('blocks a transfer from a frozen wallet', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 10n * ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).setAddressFrozen(accounts.alice.address, true);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.bob.address, ONE_SHARE),
      ).to.be.revertedWith('wallet is frozen');
    });

    it('blocks every transfer while the token is paused', async () => {
      const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 10n * ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).pause();

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.bob.address, ONE_SHARE),
      ).to.be.revertedWith('Pausable: paused');
    });
  });

  describe('all five modules together', () => {
    it('binds holder cap, lock-up and daily mint cap on top of the stock pair', async () => {
      const { suite, modules } = await loadFixture(deployFullRulesFixture);

      expect(await suite.compliance.isModuleBound(await modules.countryAllowModule.getAddress())).to.be.true;
      expect(await suite.compliance.isModuleBound(await modules.maxBalanceModule.getAddress())).to.be.true;
      expect(await suite.compliance.isModuleBound(await modules.holderCountCapModule.getAddress())).to.be.true;
      expect(await suite.compliance.isModuleBound(await modules.timeLockupModule.getAddress())).to.be.true;
      expect(await suite.compliance.isModuleBound(await modules.dailyMintCapModule.getAddress())).to.be.true;
    });

    it('blocks a transfer of still-locked tokens', async () => {
      const { accounts, suite } = await loadFixture(deployFullRulesFixture);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 10n * ONE_SHARE);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.bob.address, ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');
    });

    it('lets a verified investor transfer after the lock-up, under every cap', async () => {
      const { accounts, suite } = await loadFixture(deployFullRulesFixture);
      const amount = 1_000n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await time.increase(LOCKUP);
      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, 250n * ONE_SHARE);

      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(250n * ONE_SHARE);
    });

    it('blocks a mint that would breach the global daily mint cap', async () => {
      const { accounts, suite } = await loadFixture(deployFullRulesFixture);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, MAX_BALANCE);
      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, DAILY_MINT_CAP - MAX_BALANCE + ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('blocks a mint that would introduce a holder above the cap', async () => {
      const { accounts, suite, modules } = await loadFixture(deployFullRulesFixture);

      await suite.compliance
        .connect(accounts.safe)
        .callModuleFunction(
          modules.holderCountCapModule.interface.encodeFunctionData('setMaxHolderCount', [1n]),
          await modules.holderCountCapModule.getAddress(),
        );

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE);
      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });
  });
});
