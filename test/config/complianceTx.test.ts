import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { COUNTRY, ONE_SHARE, shareBaseUnits } from '../../config/eqowa';
import { complianceCall, describeChange, safeBatchFile, type ComplianceModules } from '../../config/complianceTx';
import { agentBurn, agentMint, setTokenPaused } from '../../config/tokenControls';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

async function fixture() {
  const suite = await deployEqowaSuiteFixture();
  const modules: ComplianceModules = {
    balanceCap: await suite.modules.maxBalanceModule.getAddress(),
    holderCountCap: await suite.modules.holderCountCapModule.getAddress(),
    dailyMintCap: await suite.modules.dailyMintCapModule.getAddress(),
    timeLockup: await suite.modules.timeLockupModule.getAddress(),
    countryAllowlist: await suite.modules.countryAllowModule.getAddress(),
  };
  return {
    ...suite,
    modules,
    complianceAddress: await suite.suite.compliance.getAddress(),
    tokenAddress: await suite.suite.token.getAddress(),
  };
}

describe('Compliance changes prepared for the Safe', () => {
  it('each prepared call changes the rule when the Safe executes it', async () => {
    const { accounts, modules, complianceAddress, suite } = await loadFixture(fixture);
    const safeExecutes = async (change: Parameters<typeof complianceCall>[0]) =>
      accounts.safe.sendTransaction({ to: complianceAddress, data: complianceCall(change, modules).data });

    await safeExecutes({ kind: 'maxBalance', shares: 200_000n });
    const balanceCap = await ethers.getContractAt('BalanceCapModule', modules.balanceCap!);
    expect(await balanceCap.getMaxBalance(complianceAddress)).to.equal(200_000n * ONE_SHARE);

    await safeExecutes({ kind: 'maxHolderCount', holders: 750n });
    const holders = await ethers.getContractAt('HolderCountCapModule', modules.holderCountCap!);
    expect(await holders.getMaxHolderCount(complianceAddress)).to.equal(750n);

    await safeExecutes({ kind: 'dailyMintCap', shares: 100_000n });
    const daily = await ethers.getContractAt('DailyMintCapModule', modules.dailyMintCap!);
    expect(await daily.getDailyMintCap(complianceAddress)).to.equal(100_000n * ONE_SHARE);

    await safeExecutes({ kind: 'lockupDays', days: 365n });
    const lockup = await ethers.getContractAt('TimeLockupModule', modules.timeLockup!);
    expect(await lockup.getLockupDuration(complianceAddress)).to.equal(365n * 86_400n);

    const countries = await ethers.getContractAt('CountryAllowlistModule', modules.countryAllowlist!);
    await safeExecutes({ kind: 'allowCountries', countries: [COUNTRY.UNITED_STATES] });
    expect(await countries.isCountryAllowed(complianceAddress, COUNTRY.UNITED_STATES)).to.equal(true);
    await safeExecutes({ kind: 'disallowCountries', countries: [COUNTRY.UNITED_STATES] });
    expect(await countries.isCountryAllowed(complianceAddress, COUNTRY.UNITED_STATES)).to.equal(false);

    expect(await suite.compliance.owner()).to.equal(accounts.safe.address);
  });

  it('is refused for anyone but the Safe', async () => {
    const { accounts, modules, complianceAddress } = await loadFixture(fixture);
    await expect(
      accounts.tokenAgent.sendTransaction({
        to: complianceAddress,
        data: complianceCall({ kind: 'maxBalance', shares: 1n }, modules).data,
      }),
    ).to.be.reverted;
  });

  it('writes a Safe Transaction Builder file with a readable description', () => {
    const file = safeBatchFile({
      chainId: 80002,
      compliance: '0x2222222222222222222222222222222222222222',
      safe: '0x3333333333333333333333333333333333333333',
      change: { kind: 'maxBalance', shares: 200_000n },
      modules: { balanceCap: '0x4444444444444444444444444444444444444444' },
      createdAt: new Date('2026-09-30T10:00:00.000Z'),
    });
    expect(file.version).to.equal('1.0');
    expect(file.chainId).to.equal('80002');
    expect(file.meta.description).to.equal('Set the per-investor holding limit to 200,000 shares');
    expect(file.transactions).to.have.length(1);
    expect(file.transactions[0].to).to.equal('0x2222222222222222222222222222222222222222');
    expect(file.transactions[0].value).to.equal('0');
    expect(describeChange({ kind: 'allowCountries', countries: [840, 124] })).to.equal('Allow countries 840, 124');
    expect(() => complianceCall({ kind: 'lockupDays', days: 1n }, {})).to.throw('not configured');
  });
});

describe('Agent token controls', () => {
  it('pauses and resumes transfers, sending nothing when already in that state', async () => {
    const { accounts, suite, tokenAddress } = await loadFixture(fixture);
    const paused = await setTokenPaused({ signer: accounts.tokenAgent, tokenAddress, paused: true });
    expect(paused.changed).to.equal(true);
    expect(await suite.token.paused()).to.equal(true);
    expect(await setTokenPaused({ signer: accounts.tokenAgent, tokenAddress, paused: true })).to.deep.equal({
      changed: false,
    });
    await setTokenPaused({ signer: accounts.tokenAgent, tokenAddress, paused: false });
    expect(await suite.token.paused()).to.equal(false);
  });

  it('mints and burns within the on-chain rules', async () => {
    const { accounts, suite, tokenAddress } = await loadFixture(fixture);
    await agentMint({
      signer: accounts.tokenAgent,
      tokenAddress,
      wallet: accounts.alice.address,
      amount: shareBaseUnits(20n),
    });
    expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(shareBaseUnits(20n));
    await agentBurn({
      signer: accounts.tokenAgent,
      tokenAddress,
      wallet: accounts.alice.address,
      amount: shareBaseUnits(5n),
    });
    expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(shareBaseUnits(15n));
    // Charlie has no verified identity: the token refuses the mint.
    await expect(
      agentMint({
        signer: accounts.tokenAgent,
        tokenAddress,
        wallet: accounts.charlie.address,
        amount: shareBaseUnits(1n),
      }),
    ).to.be.rejected;
  });
});
