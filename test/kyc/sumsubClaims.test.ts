import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { ISSUED_CLAIM_TOPICS } from '../../config/claims';
import { COUNTRY } from '../../config/eqowa';
import { parseCountryCode } from '../../config/iso3166';
import { decideKyc } from '../../config/kyc';
import { deployEqowaSuiteFixture, deployIdentityProxy, issueClaim } from '../fixtures/deployEqowaSuite';

describe('Sumsub review to ONCHAINID claims', () => {
  it('registers charlie and issues claims 1 and 2 after GREEN Nigeria', async () => {
    const { accounts, suite, keys, infrastructure } = await loadFixture(deployEqowaSuiteFixture);
    const decision = decideKyc('GREEN', parseCountryCode('NG'));
    expect(decision.action).to.equal('issue');
    if (decision.action !== 'issue') {
      return;
    }

    const identity = await deployIdentityProxy(
      await infrastructure.identityImplementationAuthority.getAddress(),
      accounts.charlie.address,
      accounts.deployer,
    );

    await suite.identityRegistry
      .connect(accounts.tokenAgent)
      .registerIdentity(accounts.charlie.address, await identity.getAddress(), decision.countryCode);

    for (const topic of ISSUED_CLAIM_TOPICS) {
      await issueClaim({
        identity,
        identityOwner: accounts.charlie,
        claimIssuer: suite.claimIssuerContract,
        signingKey: keys.claimIssuerSigningKey,
        topic,
      });
    }

    expect(decision.countryCode).to.equal(COUNTRY.NIGERIA);
    expect(await suite.identityRegistry.isVerified(accounts.charlie.address)).to.be.true;
  });

  it('does not verify charlie after GREEN United States or RED Nigeria', async () => {
    const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);

    expect(decideKyc('GREEN', parseCountryCode('US'))).to.deep.equal({
      action: 'reject',
      reason: 'blocked_country',
    });
    expect(decideKyc('RED', parseCountryCode('NGA'))).to.deep.equal({
      action: 'reject',
      reason: 'review_red',
    });
    expect(await suite.identityRegistry.isVerified(accounts.charlie.address)).to.be.false;
  });
});
