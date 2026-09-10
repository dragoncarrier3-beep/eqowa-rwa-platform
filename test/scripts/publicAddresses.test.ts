import { expect } from 'chai';
import { readFileSync } from 'node:fs';

import { AGENT_WALLET_ADDRESS, AMOY_SAFE_OWNERS, DEPLOYER_ADDRESS } from '../../config/wallets';
import { ALLOWED_COUNTRIES, TOKEN_NAME, TOKEN_SYMBOL } from '../../config/eqowa';
import type { EqowaDeployment } from '../../scripts/lib/deploymentFile';
import {
  MILESTONE_TAG,
  pendingPublicAddresses,
  publicAddressesFromDeployment,
} from '../../scripts/lib/publicAddresses';

function sampleDeployment(): EqowaDeployment {
  const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

  return {
    network: 'amoy',
    chainId: 80002,
    suiteSalt: 'eqowa-group-shares',
    deployer: DEPLOYER_ADDRESS,
    safe: address(2),
    agent: AGENT_WALLET_ADDRESS,
    claimIssuer: address(4),
    token: address(10),
    identityRegistry: address(11),
    identityRegistryStorage: address(12),
    claimTopicsRegistry: address(13),
    trustedIssuersRegistry: address(14),
    compliance: address(15),
    trexFactory: address(16),
    trexImplementationAuthority: address(17),
    identityFactory: address(18),
    identityImplementationAuthority: address(19),
    modules: {
      countryAllowlist: address(20),
      balanceCap: address(21),
      holderCountCap: address(22),
      timeLockup: address(23),
      dailyMintCap: address(24),
    },
    implementations: {
      token: address(30),
      claimTopicsRegistry: address(31),
      trustedIssuersRegistry: address(32),
      identityRegistry: address(33),
      identityRegistryStorage: address(34),
      modularCompliance: address(35),
      countryAllowlist: address(36),
      balanceCap: address(37),
      holderCountCap: address(38),
      timeLockup: address(39),
      dailyMintCap: address(40),
    },
  };
}

describe('public addresses.json', () => {
  it('matches the committed stub while Amoy is not live', async () => {
    const committed = JSON.parse(readFileSync('addresses.json', 'utf8'));
    expect(committed).to.deep.equal(pendingPublicAddresses());
  });

  it('records confirmed wallets and the 82-country rule set', async () => {
    const pending = pendingPublicAddresses();

    expect(pending.status).to.equal('not-deployed');
    expect(pending.version).to.equal(MILESTONE_TAG);
    expect(pending.contracts).to.equal(null);
    expect(pending.wallets.safe).to.equal(null);
    expect(pending.wallets.deployer).to.equal(DEPLOYER_ADDRESS);
    expect(pending.wallets.agent).to.equal(AGENT_WALLET_ADDRESS);
    expect(pending.wallets.safeOwners).to.deep.equal([...AMOY_SAFE_OWNERS]);
    expect(pending.token.symbol).to.equal(TOKEN_SYMBOL);
    expect(pending.token.name).to.equal(TOKEN_NAME);
    expect(pending.compliance.allowedCountryCount).to.equal(ALLOWED_COUNTRIES.length);
    expect(pending.compliance.lockupDays).to.equal(730);
  });

  it('fills contract addresses from a deployment file', async () => {
    const deployment = sampleDeployment();
    const published = publicAddressesFromDeployment(deployment);

    expect(published.status).to.equal('deployed');
    expect(published.wallets.safe).to.equal(deployment.safe);
    expect(published.contracts?.token).to.equal(deployment.token);
    expect(published.contracts?.modules.timeLockup).to.equal(deployment.modules.timeLockup);
    expect(published.contracts?.implementations.token).to.equal(deployment.implementations.token);
  });
});
