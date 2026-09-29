import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { COUNTRY, shareBaseUnits } from '../../config/eqowa';
import { OnboardingRefused, onboardInvestor } from '../../config/onboarding';
import { deployEqowaSuiteFixture, deployIdentityProxy } from '../fixtures/deployEqowaSuite';

async function fixture() {
  const suite = await deployEqowaSuiteFixture();
  const contracts = {
    identityRegistry: await suite.suite.identityRegistry.getAddress(),
    claimIssuer: await suite.suite.claimIssuerContract.getAddress(),
    identityImplementationAuthority: await suite.infrastructure.identityImplementationAuthority.getAddress(),
  };
  return { ...suite, contracts };
}

async function refusal(promise: Promise<unknown>, code: OnboardingRefused['code']) {
  try {
    await promise;
  } catch (error) {
    expect(error).to.be.instanceOf(OnboardingRefused);
    expect((error as OnboardingRefused).code).to.equal(code);
    return;
  }
  expect.fail(`expected ${code}`);
}

describe('On-chain investor onboarding after KYC approval', () => {
  it('registers a new investor so the token can mint to them', async () => {
    const { accounts, keys, suite, contracts } = await loadFixture(fixture);
    const { charlie, tokenAgent } = accounts;
    expect(await suite.identityRegistry.isVerified(charlie.address)).to.equal(false);
    const saved: string[] = [];

    const result = await onboardInvestor({
      wallet: charlie.address,
      countryCode: COUNTRY.GHANA,
      contracts,
      agent: tokenAgent,
      claimSigner: keys.claimIssuerSigningKey,
      onIdentityDeployed: async (address) => {
        saved.push(address);
      },
    });

    expect(result.alreadyVerified).to.equal(false);
    // Identity deploy, two claims, registry entry.
    expect(result.txHashes).to.have.length(4);
    expect(saved).to.deep.equal([result.identityAddress]);
    expect(await suite.identityRegistry.isVerified(charlie.address)).to.equal(true);
    expect(await suite.identityRegistry.identity(charlie.address)).to.equal(result.identityAddress);
    expect(await suite.identityRegistry.investorCountry(charlie.address)).to.equal(BigInt(COUNTRY.GHANA));

    await suite.token.connect(tokenAgent).mint(charlie.address, shareBaseUnits(3n));
    expect(await suite.token.balanceOf(charlie.address)).to.equal(shareBaseUnits(3n));
  });

  it('does nothing the second time', async () => {
    const { accounts, keys, contracts } = await loadFixture(fixture);
    const input = {
      wallet: accounts.charlie.address,
      countryCode: COUNTRY.GHANA,
      contracts,
      agent: accounts.tokenAgent,
      claimSigner: keys.claimIssuerSigningKey,
    };
    const first = await onboardInvestor(input);
    const second = await onboardInvestor(input);
    expect(second).to.deep.equal({ identityAddress: first.identityAddress, txHashes: [], alreadyVerified: true });
  });

  it('resumes with the identity an interrupted run deployed, without deploying another', async () => {
    const { accounts, keys, contracts, infrastructure } = await loadFixture(fixture);
    const { charlie, tokenAgent } = accounts;
    // A run that crashed right after deploying the identity.
    const orphan = await deployIdentityProxy(
      await infrastructure.identityImplementationAuthority.getAddress(),
      tokenAgent.address,
      tokenAgent,
    );

    const result = await onboardInvestor({
      wallet: charlie.address,
      countryCode: COUNTRY.GHANA,
      contracts,
      agent: tokenAgent,
      claimSigner: keys.claimIssuerSigningKey,
      knownIdentity: await orphan.getAddress(),
    });

    expect(result.identityAddress).to.equal(await orphan.getAddress());
    expect(result.txHashes).to.have.length(3);
  });

  it('adds only the missing claims to an identity registered without them', async () => {
    const { accounts, keys, suite, contracts, infrastructure } = await loadFixture(fixture);
    const { charlie, tokenAgent } = accounts;
    const identity = await deployIdentityProxy(
      await infrastructure.identityImplementationAuthority.getAddress(),
      tokenAgent.address,
      tokenAgent,
    );
    await suite.identityRegistry
      .connect(tokenAgent)
      .registerIdentity(charlie.address, await identity.getAddress(), COUNTRY.GHANA);

    const result = await onboardInvestor({
      wallet: charlie.address,
      countryCode: COUNTRY.GHANA,
      contracts,
      agent: tokenAgent,
      claimSigner: keys.claimIssuerSigningKey,
    });

    expect(result.txHashes).to.have.length(2);
    expect(await suite.identityRegistry.isVerified(charlie.address)).to.equal(true);
  });

  it('refuses an untrusted claim signer before sending anything', async () => {
    const { accounts, contracts } = await loadFixture(fixture);
    const nonceBefore = await ethers.provider.getTransactionCount(accounts.tokenAgent.address);
    await refusal(
      onboardInvestor({
        wallet: accounts.charlie.address,
        countryCode: COUNTRY.GHANA,
        contracts,
        agent: accounts.tokenAgent,
        claimSigner: ethers.Wallet.createRandom(),
      }),
      'claim_signer_not_trusted',
    );
    expect(await ethers.provider.getTransactionCount(accounts.tokenAgent.address)).to.equal(nonceBefore);
  });

  it('refuses a country code the registry cannot store', async () => {
    const { accounts, keys, contracts } = await loadFixture(fixture);
    await refusal(
      onboardInvestor({
        wallet: accounts.charlie.address,
        countryCode: 0,
        contracts,
        agent: accounts.tokenAgent,
        claimSigner: keys.claimIssuerSigningKey,
      }),
      'invalid_country',
    );
  });

  it('leaves an investor who is already verified untouched', async () => {
    const { accounts, keys, contracts, identities } = await loadFixture(fixture);
    const result = await onboardInvestor({
      wallet: accounts.alice.address,
      countryCode: COUNTRY.NIGERIA,
      contracts,
      agent: accounts.tokenAgent,
      claimSigner: keys.claimIssuerSigningKey,
    });
    expect(result).to.deep.equal({
      identityAddress: await identities.aliceIdentity.getAddress(),
      txHashes: [],
      alreadyVerified: true,
    });
  });
});
