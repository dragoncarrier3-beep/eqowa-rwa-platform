import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

import { COUNTRY, LOCKUP_DURATION_SECONDS, ONE_SHARE } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

const LOCKUP = Number(LOCKUP_DURATION_SECONDS);
const ONE_YEAR = 365 * 24 * 60 * 60;

async function deployModule(deployer: Awaited<ReturnType<typeof ethers.getSigners>>[number]) {
  const implementation = await ethers.deployContract('TimeLockupModule', [], deployer);
  const proxy = await ethers.deployContract(
    'ModuleProxy',
    [await implementation.getAddress(), implementation.interface.encodeFunctionData('initialize')],
    deployer,
  );

  return ethers.getContractAt('TimeLockupModule', await proxy.getAddress());
}

/** Suite fixture with the lock-up module bound and the agreed 730-day duration. */
async function deployWithTimeLockup() {
  const context = await loadFixture(deployEqowaSuiteFixture);
  const timeLockupModule = await deployModule(context.accounts.deployer);
  const moduleAddress = await timeLockupModule.getAddress();

  await context.suite.compliance.connect(context.accounts.safe).addModule(moduleAddress);
  await context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      timeLockupModule.interface.encodeFunctionData('setLockupDuration', [LOCKUP_DURATION_SECONDS]),
      moduleAddress,
    );

  return { ...context, timeLockupModule };
}

type Context = Awaited<ReturnType<typeof deployWithTimeLockup>>;

/** Changes the lock-up the way the Safe would, through the compliance contract. */
async function setDuration(context: Context, duration: bigint) {
  await context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      context.timeLockupModule.interface.encodeFunctionData('setLockupDuration', [duration]),
      await context.timeLockupModule.getAddress(),
    );
}

/** Releases a lock early the way the Safe would, through the compliance contract. */
async function waiveLockup(context: Context, identity: string, amount: bigint) {
  return context.suite.compliance
    .connect(context.accounts.safe)
    .callModuleFunction(
      context.timeLockupModule.interface.encodeFunctionData('waiveLockup', [identity, amount]),
      await context.timeLockupModule.getAddress(),
    );
}

/** Compliance and identity addresses, which every assertion needs. */
async function addressesOf(context: Context) {
  return {
    compliance: await context.suite.compliance.getAddress(),
    aliceId: await context.identities.aliceIdentity.getAddress(),
    bobId: await context.identities.bobIdentity.getAddress(),
  };
}

describe('TimeLockupModule', () => {
  describe('wiring', () => {
    it('binds to the compliance and reports its name', async () => {
      const { suite, timeLockupModule } = await loadFixture(deployWithTimeLockup);

      expect(await suite.compliance.isModuleBound(await timeLockupModule.getAddress())).to.be.true;
      expect(await timeLockupModule.name()).to.equal('TimeLockupModule');
      expect(await timeLockupModule.isPlugAndPlay()).to.be.false;
    });

    it('exposes the 730-day lock-up set at binding time', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { compliance } = await addressesOf(context);

      expect(await context.timeLockupModule.getLockupDuration(compliance)).to.equal(LOCKUP_DURATION_SECONDS);
    });

    it('refuses to bind to a compliance whose token already has supply', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite } = context;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, ONE_SHARE);

      const freshModule = await deployModule(accounts.deployer);
      expect(await freshModule.canComplianceBind(await suite.compliance.getAddress())).to.be.false;
    });
  });

  describe('access control', () => {
    it('rejects setLockupDuration called directly rather than through the compliance', async () => {
      const { accounts, timeLockupModule } = await loadFixture(deployWithTimeLockup);

      await expect(timeLockupModule.connect(accounts.safe).setLockupDuration(0n)).to.be.revertedWith(
        'only bound compliance can call',
      );
    });

    it('rejects module actions from anyone but the bound compliance', async () => {
      const { accounts, timeLockupModule } = await loadFixture(deployWithTimeLockup);

      await expect(
        timeLockupModule.connect(accounts.outsider).moduleMintAction(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWith('only bound compliance can call');
    });
  });

  describe('locking at mint', () => {
    it('locks the whole of a freshly minted tranche', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(amount);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(0n);
    });

    it('records the tranche with a release 730 days out', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      const mintedAt = await time.latest();

      const [amounts, releaseTimes] = await timeLockupModule.getLockedTranches(compliance, aliceId);

      expect(amounts).to.deep.equal([amount]);
      expect(releaseTimes[0]).to.equal(BigInt(mintedAt + LOCKUP));
    });

    it('blocks a transfer of locked tokens', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite } = context;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.bob.address, ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');
    });
  });

  describe('releasing tranches', () => {
    it('releases the tranche once the lock-up has run', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await time.increase(LOCKUP);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(0n);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(amount);

      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, amount);
      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(amount);
    });

    it('releases each tranche on its own clock, not on the first mint', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const first = 100n * ONE_SHARE;
      const second = 50n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, first);
      const firstMintedAt = await time.latest();

      await time.increase(ONE_YEAR);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, second);

      // Far enough for the first tranche to release, not the second.
      await time.increaseTo(firstMintedAt + LOCKUP);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(second);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(first);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.bob.address, first + ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');

      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, first);
      expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(second);
    });
  });

  describe('transfers between investors', () => {
    it('does not re-lock tokens that arrive by transfer', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, bobId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await time.increase(LOCKUP);
      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, amount);

      // Anything that can be transferred has already served its lock-up.
      expect(await timeLockupModule.getLockedAmount(compliance, bobId)).to.equal(0n);
      expect(await timeLockupModule.getSpendableAmount(compliance, bobId)).to.equal(amount);
    });

    it('pools the lock-up across the wallets of one investor', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);

      // Give alice a second wallet backed by the same ONCHAINID.
      await suite.identityRegistry
        .connect(accounts.tokenAgent)
        .registerIdentity(accounts.outsider.address, aliceId, COUNTRY.NIGERIA);

      const matured = 100n * ONE_SHARE;
      const fresh = 40n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, matured);
      await time.increase(LOCKUP);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, fresh);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(fresh);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(matured);

      // Shuffling between her own wallets leaves the pool untouched.
      await suite.token.connect(accounts.alice).transfer(accounts.outsider.address, matured);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(fresh);
      expect(await timeLockupModule.getIDBalance(compliance, aliceId)).to.equal(matured + fresh);
    });
  });

  describe('burning', () => {
    it('destroys the tranche when locked tokens are burned', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await suite.token.connect(accounts.tokenAgent).burn(accounts.alice.address, amount);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(0n);
      expect(await timeLockupModule.getIDBalance(compliance, aliceId)).to.equal(0n);
    });

    it('keeps the remainder locked after a partial burn', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);
      await suite.token.connect(accounts.tokenAgent).burn(accounts.alice.address, 60n * ONE_SHARE);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(40n * ONE_SHARE);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(0n);
    });
  });

  describe('forced transfers', () => {
    it('carries the lock across to the recipient', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId, bobId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      const mintedAt = await time.latest();

      // forcedTransfer skips canTransfer, so the module has to defend itself.
      await suite.token.connect(accounts.tokenAgent).forcedTransfer(accounts.alice.address, accounts.bob.address, amount);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(0n);
      expect(await timeLockupModule.getLockedAmount(compliance, bobId)).to.equal(amount);

      const [, releaseTimes] = await timeLockupModule.getLockedTranches(compliance, bobId);
      expect(releaseTimes[0]).to.equal(BigInt(mintedAt + LOCKUP));
    });

    it('leaves the recipient unable to move the carried lock', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite } = context;
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await suite.token.connect(accounts.tokenAgent).forcedTransfer(accounts.alice.address, accounts.bob.address, amount);

      await expect(
        suite.token.connect(accounts.bob).transfer(accounts.alice.address, ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');
    });
  });

  describe('waiving a lock-up', () => {
    it('rejects waiveLockup called directly rather than through the compliance', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, timeLockupModule } = context;
      const { aliceId } = await addressesOf(context);

      await expect(
        timeLockupModule.connect(accounts.safe).waiveLockup(aliceId, ONE_SHARE),
      ).to.be.revertedWith('only bound compliance can call');
    });

    it('frees the waived amount without changing the balance', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;
      const waived = 30n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await waiveLockup(context, aliceId, waived);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(amount - waived);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(waived);
      expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(amount);
      expect(await suite.token.totalSupply()).to.equal(amount);
    });

    it('lets the investor move what was waived, and no more', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite } = context;
      const { aliceId } = await addressesOf(context);
      const waived = 30n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 100n * ONE_SHARE);
      await waiveLockup(context, aliceId, waived);

      await expect(
        suite.token.connect(accounts.alice).transfer(accounts.bob.address, waived + ONE_SHARE),
      ).to.be.revertedWith('Transfer not possible');

      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, waived);
      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(waived);
    });

    it('releases the soonest-dated tranche first', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const first = 40n * ONE_SHARE;
      const second = 60n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, first);
      await time.increase(ONE_YEAR);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, second);
      const secondMintedAt = await time.latest();

      // Exactly the size of the first tranche, so only it should go.
      await waiveLockup(context, aliceId, first);

      const [amounts, releaseTimes] = await timeLockupModule.getLockedTranches(compliance, aliceId);

      expect(amounts).to.deep.equal([second]);
      expect(releaseTimes[0]).to.equal(BigInt(secondMintedAt + LOCKUP));
      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(second);
    });

    it('clears the lock entirely when waived for more than is locked', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);
      await waiveLockup(context, aliceId, amount * 10n);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(0n);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(amount);
    });

    it('reports only what was actually released', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);

      await expect(waiveLockup(context, aliceId, amount * 10n))
        .to.emit(timeLockupModule, 'LockupWaived')
        .withArgs(compliance, aliceId, amount);
    });
  });

  describe('changing the duration', () => {
    it('mints unlocked when the duration is zero', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const amount = 100n * ONE_SHARE;

      await setDuration(context, 0n);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, amount);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(0n);
      await suite.token.connect(accounts.alice).transfer(accounts.bob.address, amount);
      expect(await suite.token.balanceOf(accounts.bob.address)).to.equal(amount);
    });

    it('never retro-dates tranches already under lock', async () => {
      const context = await loadFixture(deployWithTimeLockup);
      const { accounts, suite, timeLockupModule } = context;
      const { compliance, aliceId } = await addressesOf(context);
      const locked = 100n * ONE_SHARE;
      const free = 25n * ONE_SHARE;

      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, locked);
      await setDuration(context, 0n);
      await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, free);

      expect(await timeLockupModule.getLockedAmount(compliance, aliceId)).to.equal(locked);
      expect(await timeLockupModule.getSpendableAmount(compliance, aliceId)).to.equal(free);
    });
  });
});
