import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { ALLOWED_COUNTRIES, COUNTRY, ONE_SHARE } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

async function deployWithCountryAllowlist() {
  const context = await loadFixture(deployEqowaSuiteFixture);
  return { ...context, countryAllowlistModule: context.modules.countryAllowModule };
}

describe('CountryAllowlistModule', () => {
  it('binds as plug-and-play and reports its name', async () => {
    const { suite, modules } = await loadFixture(deployWithCountryAllowlist);

    expect(await suite.compliance.isModuleBound(await modules.countryAllowModule.getAddress())).to.be.true;
    expect(await modules.countryAllowModule.name()).to.equal('CountryAllowlistModule');
    expect(await modules.countryAllowModule.isPlugAndPlay()).to.be.true;
    expect(await modules.countryAllowModule.canComplianceBind(await suite.compliance.getAddress())).to.be.true;
  });

  it('allows a mint to an investor in an allowed country', async () => {
    const { accounts, suite } = await loadFixture(deployWithCountryAllowlist);

    await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 10n * ONE_SHARE);
    expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(10n * ONE_SHARE);
  });

  it('blocks a mint to an investor whose country is not on the list', async () => {
    const context = await loadFixture(deployWithCountryAllowlist);
    const { accounts, suite, identities } = context;

    // David is registered in the fixture as United States (840), which is excluded.
    await expect(
      suite.token.connect(accounts.tokenAgent).mint(accounts.david.address, ONE_SHARE),
    ).to.be.revertedWith('Compliance not followed');

    expect(identities.davidIdentity).to.exist;
  });

  it('lets the Safe add a country and then mint to that investor', async () => {
    const { accounts, suite, modules } = await loadFixture(deployWithCountryAllowlist);
    const moduleAddress = await modules.countryAllowModule.getAddress();

    await expect(
      suite.token.connect(accounts.tokenAgent).mint(accounts.david.address, ONE_SHARE),
    ).to.be.revertedWith('Compliance not followed');

    await suite.compliance
      .connect(accounts.safe)
      .callModuleFunction(
        modules.countryAllowModule.interface.encodeFunctionData('addAllowedCountry', [COUNTRY.UNITED_STATES]),
        moduleAddress,
      );

    await suite.token.connect(accounts.tokenAgent).mint(accounts.david.address, ONE_SHARE);
    expect(await suite.token.balanceOf(accounts.david.address)).to.equal(ONE_SHARE);
  });

  it('applies the full production allow-list through chunked factory calls', async () => {
    const { suite, modules } = await loadFixture(deployWithCountryAllowlist);
    const complianceAddress = await suite.compliance.getAddress();

    for (const country of ALLOWED_COUNTRIES) {
      expect(await modules.countryAllowModule.isCountryAllowed(complianceAddress, country)).to.be.true;
    }

    expect(await modules.countryAllowModule.isCountryAllowed(complianceAddress, COUNTRY.UNITED_STATES)).to.be.false;
  });

  it('rejects addAllowedCountry called directly rather than through the compliance', async () => {
    const { accounts, modules } = await loadFixture(deployWithCountryAllowlist);

    await expect(
      modules.countryAllowModule.connect(accounts.safe).addAllowedCountry(COUNTRY.UNITED_STATES),
    ).to.be.revertedWithCustomError(modules.countryAllowModule, 'ComplianceNotBound');
  });
});
