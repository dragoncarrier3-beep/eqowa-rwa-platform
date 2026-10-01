import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { shareBaseUnits } from '../../config/eqowa';
import { setWalletFrozen } from '../../config/tokenControls';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

async function fixture() {
  const suite = await deployEqowaSuiteFixture();
  await suite.suite.token.connect(suite.accounts.tokenAgent).mint(suite.accounts.alice.address, shareBaseUnits(10n));
  return { ...suite, tokenAddress: await suite.suite.token.getAddress() };
}

describe('Admin token controls', () => {
  it('freezes a wallet so it can neither send nor receive, then unfreezes it', async () => {
    const { accounts, suite, tokenAddress } = await loadFixture(fixture);
    const { tokenAgent, alice, bob } = accounts;

    const frozen = await setWalletFrozen({ signer: tokenAgent, tokenAddress, wallet: alice.address, frozen: true });
    expect(frozen.changed).to.equal(true);
    expect(await suite.token.isFrozen(alice.address)).to.equal(true);
    await expect(suite.token.connect(alice).transfer(bob.address, shareBaseUnits(1n))).to.be.reverted;

    const unfrozen = await setWalletFrozen({ signer: tokenAgent, tokenAddress, wallet: alice.address, frozen: false });
    expect(unfrozen.changed).to.equal(true);
    expect(await suite.token.isFrozen(alice.address)).to.equal(false);
  });

  it('sends nothing when the wallet is already in the requested state', async () => {
    const { accounts, tokenAddress } = await loadFixture(fixture);
    const nonce = await ethers.provider.getTransactionCount(accounts.tokenAgent.address);
    const result = await setWalletFrozen({
      signer: accounts.tokenAgent,
      tokenAddress,
      wallet: accounts.alice.address,
      frozen: false,
    });
    expect(result).to.deep.equal({ changed: false });
    expect(await ethers.provider.getTransactionCount(accounts.tokenAgent.address)).to.equal(nonce);
  });

  it('is refused on-chain for anyone who is not the token agent', async () => {
    const { accounts, tokenAddress } = await loadFixture(fixture);
    await expect(
      setWalletFrozen({ signer: accounts.outsider, tokenAddress, wallet: accounts.alice.address, frozen: true }),
    ).to.be.rejected;
  });
});
