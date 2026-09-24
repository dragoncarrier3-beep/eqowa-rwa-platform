import { expect } from 'chai';
import { ethers } from 'hardhat';

import { TOKEN_DECIMALS, TOKEN_NAME, TOKEN_SYMBOL } from '../../config/eqowa';
import type { EqowaDeployment } from '../../scripts/lib/deploymentFile';
import { verificationTargets } from '../../scripts/lib/verificationTargets';

function sampleDeployment(): EqowaDeployment {
  const address = (n: number) => ethers.getAddress(`0x${n.toString(16).padStart(40, '0')}`);

  return {
    network: 'amoy',
    chainId: 80002,
    suiteSalt: 'eqowa-group-shares',
    deployer: address(1),
    safe: address(2),
    agent: address(3),
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
    claimIssuerManagementKey: address(1),
  };
}

describe('Polygonscan verification targets', () => {
  it('covers implementations, suite proxies and module proxies', async () => {
    const targets = verificationTargets(sampleDeployment());
    const names = targets.map((target) => target.name);

    expect(targets).to.have.length(25);
    expect(names).to.include('TokenProxy');
    expect(names).to.include('TREXFactory');
    expect(names).to.include('CountryAllowlistModule implementation');
    expect(names).to.include('TimeLockupModule proxy');
    expect(names).to.include('ClaimIssuer');
  });

  it('reconstructs TokenProxy constructor args from the factory path', async () => {
    const deployment = sampleDeployment();
    const tokenProxy = verificationTargets(deployment).find((target) => target.name === 'TokenProxy');

    expect(tokenProxy?.args).to.deep.equal([
      deployment.trexImplementationAuthority,
      deployment.identityRegistry,
      deployment.compliance,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_DECIMALS,
      ethers.ZeroAddress,
    ]);
  });

  it('adds the settlement contracts once they are deployed', async () => {
    const deployment = sampleDeployment();
    const address = (n: number) => ethers.getAddress(`0x${n.toString(16).padStart(40, '0')}`);
    deployment.settlement = {
      owner: deployment.safe,
      usdt: address(50),
      forwarder: address(51),
      escrow: address(52),
      escrowDeployBlock: 100,
    };

    const targets = verificationTargets(deployment);
    const escrow = targets.find((target) => target.name === 'Escrow');

    expect(targets).to.have.length(28);
    expect(targets.map((target) => target.name)).to.include.members(['MockUSDT', 'EqowaMinimalForwarder']);
    expect(escrow?.args).to.deep.equal([address(50), deployment.safe, address(51)]);
  });

  it('omits ClaimIssuer when we did not deploy it', async () => {
    const deployment = sampleDeployment();
    delete deployment.claimIssuerManagementKey;

    const names = verificationTargets(deployment).map((target) => target.name);
    expect(names).to.not.include('ClaimIssuer');
    expect(names).to.have.length(24);
  });
});
