import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { executeTokenMint } from '../../config/agentMint';
import { ONE_USDT, shareBaseUnits } from '../../config/eqowa';
import { encodeEscrowDeposit, FORWARD_REQUEST_TYPES, forwarderDomain } from '../../config/forwarder';
import { relayEscrowDeposit } from '../../config/relayer';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

const INTENT = ethers.id('m2-06-relay');

async function deployRelayFixture() {
  const suite = await deployEqowaSuiteFixture();
  const [owner] = await ethers.getSigners();
  const forwarder = await ethers.deployContract('EqowaMinimalForwarder', [], owner);
  const usdt = await ethers.deployContract('MockUSDT', [], owner);
  const escrow = await ethers.deployContract(
    'Escrow',
    [await usdt.getAddress(), owner.address, await forwarder.getAddress()],
    owner,
  );
  const amount = 5n * ONE_USDT;
  await usdt.mint(suite.accounts.alice.address, amount);
  await usdt.connect(suite.accounts.alice).approve(await escrow.getAddress(), amount);
  return { ...suite, owner, forwarder, usdt, escrow, amount };
}

describe('ERC-2771 deposit relayer and agent mint', () => {
  it('relays alice deposit so the escrow still records her as payer', async () => {
    const { accounts, owner, forwarder, escrow, amount } = await loadFixture(deployRelayFixture);
    const escrowAddress = await escrow.getAddress();
    const forwarderAddress = await forwarder.getAddress();
    const request = {
      from: accounts.alice.address,
      to: escrowAddress,
      value: 0n,
      gas: 500_000n,
      nonce: await forwarder.getNonce(accounts.alice.address),
      data: encodeEscrowDeposit(INTENT, amount),
    };
    const domain = forwarderDomain((await ethers.provider.getNetwork()).chainId, forwarderAddress);
    const signature = await accounts.alice.signTypedData(domain, FORWARD_REQUEST_TYPES, request);

    const relayed = await relayEscrowDeposit({
      input: { request, signature },
      escrowAddress,
      forwarderAddress,
      chainId: (await ethers.provider.getNetwork()).chainId,
      relayer: owner,
    });

    expect(relayed.amount).to.equal(amount);
    expect(await escrow.intentPayer(INTENT)).to.equal(accounts.alice.address);
  });

  it('mints through the agent signer adapter', async () => {
    const { accounts, suite } = await loadFixture(deployRelayFixture);
    const txHash = await executeTokenMint({
      signer: accounts.tokenAgent,
      tokenAddress: await suite.token.getAddress(),
      to: accounts.alice.address,
      amount: shareBaseUnits(1n),
    });

    expect(txHash).to.match(/^0x/);
    expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(shareBaseUnits(1n));
  });
});
