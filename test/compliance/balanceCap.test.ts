import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { MAX_BALANCE, ONE_SHARE } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

async function deployWithBalanceCap() {
  const context = await loadFixture(deployEqowaSuiteFixture);
  return { ...context, balanceCapModule: context.modules.maxBalanceModule };
}

describe('BalanceCapModule', () => {
  it('binds and exposes the 150,000-share cap', async () => {
    const { suite, modules } = await loadFixture(deployWithBalanceCap);
    const complianceAddress = await suite.compliance.getAddress();

    expect(await suite.compliance.isModuleBound(await modules.maxBalanceModule.getAddress())).to.be.true;
    expect(await modules.maxBalanceModule.name()).to.equal('BalanceCapModule');
    expect(await modules.maxBalanceModule.getMaxBalance(complianceAddress)).to.equal(MAX_BALANCE);
  });

  it('allows a mint below the cap', async () => {
    const { accounts, suite } = await loadFixture(deployWithBalanceCap);

    await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 1_000n * ONE_SHARE);
    expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(1_000n * ONE_SHARE);
  });

  it('blocks a mint that would exceed the cap', async () => {
    const { accounts, suite } = await loadFixture(deployWithBalanceCap);

    await expect(
      suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, MAX_BALANCE + ONE_SHARE),
    ).to.be.revertedWith('Compliance not followed');
  });

  it('counts two wallets of the same investor against one cap', async () => {
    const { accounts, suite, identities } = await loadFixture(deployWithBalanceCap);

    await suite.identityRegistry
      .connect(accounts.tokenAgent)
      .registerIdentity(accounts.outsider.address, await identities.aliceIdentity.getAddress(), 566);

    await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, MAX_BALANCE);
    await suite.token.connect(accounts.alice).transfer(accounts.outsider.address, 10n * ONE_SHARE);

    await expect(
      suite.token.connect(accounts.tokenAgent).mint(accounts.outsider.address, ONE_SHARE),
    ).to.be.revertedWith('Compliance not followed');
  });

  it('rejects setMaxBalance called directly rather than through the compliance', async () => {
    const { accounts, modules } = await loadFixture(deployWithBalanceCap);

    await expect(modules.maxBalanceModule.connect(accounts.safe).setMaxBalance(1n)).to.be.revertedWithCustomError(
      modules.maxBalanceModule,
      'ComplianceNotBound',
    );
  });
});
