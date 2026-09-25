import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { createTokenMintExecutor } from '../../config/agentMint';
import { shareBaseUnits } from '../../config/eqowa';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

describe('agent mint executor on the T-REX suite', () => {
  it('returns the hash on broadcast and reports success from the receipt', async () => {
    const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);
    const executor = createTokenMintExecutor({
      signer: accounts.tokenAgent,
      tokenAddress: await suite.token.getAddress(),
    });
    const amount = shareBaseUnits(2n);

    const txHash = await executor.send({ to: accounts.alice.address, shareAmount: amount, intentId: ethers.id('a') });

    expect(txHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(await executor.wait(txHash)).to.equal('success');
    expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(amount);
  });

  it('rejects at broadcast when the token would revert, so nothing is recorded as sent', async () => {
    const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);
    const executor = createTokenMintExecutor({
      signer: accounts.tokenAgent,
      tokenAddress: await suite.token.getAddress(),
    });

    // Charlie has no identity, so the token refuses the mint.
    await expect(
      executor.send({ to: accounts.charlie.address, shareAmount: shareBaseUnits(1n), intentId: ethers.id('b') }),
    ).to.be.rejected;
    expect(await suite.token.balanceOf(accounts.charlie.address)).to.equal(0n);
  });

  it('refuses a mint from a wallet without AGENT_ROLE', async () => {
    const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);
    const executor = createTokenMintExecutor({
      signer: accounts.outsider,
      tokenAddress: await suite.token.getAddress(),
    });

    await expect(
      executor.send({ to: accounts.alice.address, shareAmount: shareBaseUnits(1n), intentId: ethers.id('c') }),
    ).to.be.rejected;
  });
});
