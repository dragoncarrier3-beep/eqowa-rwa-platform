import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

import { DAILY_MINT_CAP, ONE_SHARE } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

const ONE_DAY = 24 * 60 * 60;

/**
 * The production cap is 250,000 shares, above the 150,000 per-identity balance
 * cap already bound to the suite. Tests use a smaller cap so a single investor
 * can reach it without tripping MaxBalanceModule first.
 */
const TEST_CAP = 1_000n * ONE_SHARE;

async function deployModule(deployer: Awaited<ReturnType<typeof ethers.getSigners>>[number]) {
  const implementation = await ethers.deployContract('DailyMintCapModule', [], deployer);
  const proxy = await ethers.deployContract(
    'ComplianceModuleProxy',
    [await implementation.getAddress(), implementation.interface.encodeFunctionData('initialize')],
    deployer,
  );

  return ethers.getContractAt('DailyMintCapModule', await proxy.getAddress());
}

/** Suite fixture with the daily mint cap module bound. */
async function deployWithDailyMintCap() {
  const context = await loadFixture(deployEqowaSuiteFixture);
  const dailyMintCapModule = await deployModule(context.accounts.deployer);
  const moduleAddress = await dailyMintCapModule.getAddress();

  await context.suite.compliance.connect(context.accounts.safe).addModule(moduleAddress);
  await context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      dailyMintCapModule.interface.encodeFunctionData('setDailyMintCap', [TEST_CAP]),
      moduleAddress,
    );

  return { ...context, dailyMintCapModule };
}

type Context = Awaited<ReturnType<typeof deployWithDailyMintCap>>;

/** Changes the cap the way the Safe would, through the compliance contract. */
async function setCap(context: Context, cap: bigint) {
  return context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      context.dailyMintCapModule.interface.encodeFunctionData('setDailyMintCap', [cap]),
      await context.dailyMintCapModule.getAddress(),
    );
}

describe('DailyMintCapModule', () => {
  describe('wiring', () => {
    it('binds to the compliance and reports its name', async () => {
      const { suite, dailyMintCapModule } = await loadFixture(deployWithDailyMintCap);

      expect(await suite.compliance.isModuleBound(await dailyMintCapModule.getAddress())).to.be.true;
      expect(await dailyMintCapModule.name()).to.equal('DailyMintCapModule');
      expect(await dailyMintCapModule.isPlugAndPlay()).to.be.false;
    });

    it('measures the cap over a rolling 24 hours', async () => {
      const { dailyMintCapModule } = await loadFixture(deployWithDailyMintCap);

      expect(await dailyMintCapModule.MINT_WINDOW()).to.equal(BigInt(ONE_DAY));
    });

    it('exposes the cap set at binding time', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const complianceAddress = await context.suite.compliance.getAddress();

      expect(await context.dailyMintCapModule.getDailyMintCap(complianceAddress)).to.equal(TEST_CAP);
    });

    it('refuses to bind to a compliance whose token already has supply', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite } = context;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE);

      const freshModule = await deployModule(accounts.deployer);
      expect(await freshModule.canComplianceBind(await suite.compliance.getAddress())).to.be.false;
    });
  });

  describe('access control', () => {
    it('rejects setDailyMintCap called directly rather than through the compliance', async () => {
      const { accounts, dailyMintCapModule } = await loadFixture(deployWithDailyMintCap);

      await expect(
        dailyMintCapModule.connect(accounts.safe).setDailyMintCap(TEST_CAP),
      ).to.be.revertedWithCustomError(dailyMintCapModule, 'ComplianceNotBound');
    });

    it('rejects module actions from anyone but the bound compliance', async () => {
      const { accounts, dailyMintCapModule } = await loadFixture(deployWithDailyMintCap);

      await expect(
        dailyMintCapModule.connect(accounts.outsider).moduleMintAction(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWithCustomError(dailyMintCapModule, 'ComplianceNotBound');
    });
  });

  describe('enforcing the cap', () => {
    it('allows a mint below the cap', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();
      const amount = 400n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);

      expect(await dailyMintCapModule.getMintedInWindow(complianceAddress)).to.equal(amount);
      expect(await dailyMintCapModule.getRemainingAllowance(complianceAddress)).to.equal(TEST_CAP - amount);
    });

    it('allows mints that add up to exactly the cap', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 600n * ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, 400n * ONE_SHARE);

      expect(await dailyMintCapModule.getMintedInWindow(complianceAddress)).to.equal(TEST_CAP);
      expect(await dailyMintCapModule.getRemainingAllowance(complianceAddress)).to.equal(0n);
    });

    it('blocks the mint that would cross the cap', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite } = context;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 900n * ONE_SHARE);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, 200n * ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('blocks a single mint larger than the whole cap', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite } = context;

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, TEST_CAP + ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('applies the cap across the whole token, not per investor', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();

      // Neither investor is individually near the cap, but together they are.
      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 500n * ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, 500n * ONE_SHARE);

      expect(await dailyMintCapModule.getMintedInWindow(complianceAddress)).to.equal(TEST_CAP);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('blocks every mint when the cap is left at zero', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite } = context;

      await setCap(context, 0n);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('lets the Safe raise the cap to admit more issuance', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite } = context;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, TEST_CAP);
      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');

      await setCap(context, TEST_CAP * 2n);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, ONE_SHARE);

      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(ONE_SHARE);
    });
  });

  describe('the rolling window', () => {
    it('frees the whole allowance once 24 hours have passed', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, TEST_CAP);
      expect(await dailyMintCapModule.getRemainingAllowance(complianceAddress)).to.equal(0n);

      await time.increase(ONE_DAY);

      expect(await dailyMintCapModule.getMintedInWindow(complianceAddress)).to.equal(0n);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, TEST_CAP);
      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(TEST_CAP);
    });

    it('ages out each mint on its own clock', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();
      const first = 600n * ONE_SHARE;
      const second = 400n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, first);
      const firstMintedAt = await time.latest();

      await time.increase(ONE_DAY / 2);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, second);

      // Far enough for the first mint to age out, not the second.
      await time.increaseTo(firstMintedAt + ONE_DAY);

      expect(await dailyMintCapModule.getMintedInWindow(complianceAddress)).to.equal(second);
      expect(await dailyMintCapModule.getRemainingAllowance(complianceAddress)).to.equal(TEST_CAP - second);
    });

    it('does not reset at a fixed boundary, so the cap cannot be doubled', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite } = context;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, TEST_CAP);

      // One second short of the window. A calendar-day cap would have reset.
      await time.increase(ONE_DAY - 60);

      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.bob.address, ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });

    it('reports when the next allowance becomes available', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, TEST_CAP);
      const mintedAt = await time.latest();

      expect(await dailyMintCapModule.getNextReleaseTime(complianceAddress)).to.equal(
        BigInt(mintedAt + ONE_DAY),
      );
    });
  });

  describe('what the cap does not touch', () => {
    it('does not count transfers against the cap', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, TEST_CAP);
      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, 500n * ONE_SHARE);

      expect(await dailyMintCapModule.getMintedInWindow(complianceAddress)).to.equal(TEST_CAP);
    });

    it('does not return allowance when tokens are burned', async () => {
      const context = await loadFixture(deployWithDailyMintCap);
      const { accounts, suite, dailyMintCapModule } = context;
      const complianceAddress = await suite.compliance.getAddress();

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, TEST_CAP);
      await suite.token.connect(accounts.tokenAgent).burn(accounts.alice.address, TEST_CAP);

      // The cap limits issuance rate, so a mint and burn still spends the day.
      expect(await dailyMintCapModule.getMintedInWindow(complianceAddress)).to.equal(TEST_CAP);
      await expect(
        suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWith('Compliance not followed');
    });
  });

  describe('the agreed production cap', () => {
    it('is 250,000 shares', async () => {
      expect(DAILY_MINT_CAP).to.equal(250_000n * ONE_SHARE);
    });
  });
});
