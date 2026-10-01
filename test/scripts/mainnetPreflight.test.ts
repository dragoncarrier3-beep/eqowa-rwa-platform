import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import {
  checkAgent,
  checkClaimSigner,
  checkFunded,
  checkOwnedBySafe,
  checkSafe,
  checkUsdt,
  renderChecks,
} from '../../scripts/lib/mainnetPreflight';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

async function fixture() {
  const suite = await deployEqowaSuiteFixture();
  const usdt = await ethers.deployContract('MockUSDT', [], suite.accounts.deployer);
  return { ...suite, usdt, usdtAddress: await usdt.getAddress() };
}

describe('Mainnet preflight', () => {
  it('accepts a USDT whose meta-transaction domain matches the config, and refuses one on the wrong chain', async () => {
    const { usdtAddress } = await loadFixture(fixture);
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const good = await checkUsdt(ethers.provider, usdtAddress, chainId);
    expect(
      good.every((check) => check.ok),
      renderChecks(good),
    ).to.equal(true);

    // Signing for chain 137 against a contract on another chain would fail every approval.
    const wrongChain = await checkUsdt(ethers.provider, usdtAddress, 137n);
    expect(wrongChain.find((check) => check.name === 'USDT meta-transaction domain')?.ok).to.equal(false);

    const [, , , , , , , , outsider] = await ethers.getSigners();
    const empty = await checkUsdt(ethers.provider, outsider.address, chainId);
    expect(empty).to.have.length(1);
    expect(empty[0].ok).to.equal(false);
  });

  it('checks the claim signing key on the ClaimIssuer', async () => {
    const { suite, keys, accounts } = await loadFixture(fixture);
    const issuer = await suite.claimIssuerContract.getAddress();
    expect((await checkClaimSigner(ethers.provider, issuer, keys.claimIssuerSigningKey.address)).ok).to.equal(true);
    expect((await checkClaimSigner(ethers.provider, issuer, accounts.outsider.address)).ok).to.equal(false);
  });

  it('checks the agent on the token and the identity registry', async () => {
    const { suite, accounts } = await loadFixture(fixture);
    const contracts = {
      token: await suite.token.getAddress(),
      identityRegistry: await suite.identityRegistry.getAddress(),
    };
    const agent = await checkAgent(ethers.provider, contracts, accounts.tokenAgent.address);
    expect(
      agent.every((check) => check.ok),
      renderChecks(agent),
    ).to.equal(true);
    const outsider = await checkAgent(ethers.provider, contracts, accounts.outsider.address);
    expect(outsider.some((check) => check.ok)).to.equal(false);
  });

  it('checks that the Safe owns the contracts', async () => {
    const { suite, accounts } = await loadFixture(fixture);
    const contracts = {
      Token: await suite.token.getAddress(),
      'Identity registry': await suite.identityRegistry.getAddress(),
      Compliance: await suite.compliance.getAddress(),
    };
    const owned = await checkOwnedBySafe(ethers.provider, contracts, accounts.safe.address);
    expect(
      owned.every((check) => check.ok),
      renderChecks(owned),
    ).to.equal(true);
    const notOwned = await checkOwnedBySafe(ethers.provider, contracts, accounts.deployer.address);
    expect(notOwned.some((check) => check.ok)).to.equal(false);
  });

  it('refuses a Safe address without code, and reports gas money', async () => {
    const { accounts } = await loadFixture(fixture);
    const safe = await checkSafe(ethers.provider, accounts.safe.address);
    expect(safe).to.have.length(1);
    expect(safe[0].ok).to.equal(false);

    const format = (wei: bigint) => `${ethers.formatEther(wei)} ETH`;
    expect((await checkFunded(ethers.provider, 'Agent', accounts.tokenAgent.address, 1n, format)).ok).to.equal(true);
    const broke = ethers.Wallet.createRandom().address;
    expect((await checkFunded(ethers.provider, 'Agent', broke, 1n, format)).ok).to.equal(false);
  });
});
