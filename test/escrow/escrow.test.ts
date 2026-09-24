import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { encodeEscrowDeposit, FORWARD_REQUEST_TYPES, forwarderDomain } from '../../config/forwarder';
import { ONE_USDT } from '../../config/eqowa';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';

const INTENT = ethers.id('intent-1');

async function deployEscrowFixture() {
  const [owner, investor, relayer, other] = await ethers.getSigners();

  const { forwarder, usdt, escrow } = await deploySettlementContracts({ deployer: owner, owner: owner.address });
  const otherToken = await ethers.deployContract('MockUSDT', [], owner);

  await usdt.mint(investor.address, 20n * ONE_USDT);
  await otherToken.mint(investor.address, 20n * ONE_USDT);

  return { owner, investor, relayer, other, forwarder, usdt, otherToken, escrow };
}

describe('Escrow', () => {
  it('records a USDT deposit against an intent', async () => {
    const { investor, usdt, escrow } = await loadFixture(deployEscrowFixture);
    const amount = 5n * ONE_USDT;

    await usdt.connect(investor).approve(await escrow.getAddress(), amount);
    await expect(escrow.connect(investor).deposit(INTENT, amount))
      .to.emit(escrow, 'Deposited')
      .withArgs(INTENT, investor.address, amount, await usdt.getAddress());

    expect(await escrow.intentUsed(INTENT)).to.equal(true);
    expect(await escrow.intentPayer(INTENT)).to.equal(investor.address);
    expect(await escrow.intentAmount(INTENT)).to.equal(amount);
    expect(await usdt.balanceOf(await escrow.getAddress())).to.equal(amount);
  });

  it('rejects a reused intentId', async () => {
    const { investor, usdt, escrow } = await loadFixture(deployEscrowFixture);
    const amount = 5n * ONE_USDT;

    await usdt.connect(investor).approve(await escrow.getAddress(), amount * 2n);
    await escrow.connect(investor).deposit(INTENT, amount);

    await expect(escrow.connect(investor).deposit(INTENT, amount)).to.be.revertedWithCustomError(
      escrow,
      'IntentAlreadyUsed',
    );
  });

  it('rejects a zero amount', async () => {
    const { investor, escrow } = await loadFixture(deployEscrowFixture);

    await expect(escrow.connect(investor).deposit(INTENT, 0n)).to.be.revertedWithCustomError(escrow, 'ZeroAmount');
  });

  it('does not pull a wrong token on deposit; owner can sweep it', async () => {
    const { owner, investor, usdt, otherToken, escrow } = await loadFixture(deployEscrowFixture);
    const amount = 5n * ONE_USDT;

    await otherToken.connect(investor).transfer(await escrow.getAddress(), amount);
    await usdt.connect(investor).approve(await escrow.getAddress(), amount);
    await escrow.connect(investor).deposit(INTENT, amount);

    expect(await usdt.balanceOf(await escrow.getAddress())).to.equal(amount);
    expect(await otherToken.balanceOf(await escrow.getAddress())).to.equal(amount);

    await expect(escrow.connect(owner).sweep(await otherToken.getAddress(), owner.address, amount))
      .to.emit(escrow, 'Swept')
      .withArgs(await otherToken.getAddress(), owner.address, amount);
    expect(await otherToken.balanceOf(owner.address)).to.equal(amount);
  });

  it('lets the owner refund a recorded intent', async () => {
    const { owner, investor, usdt, escrow } = await loadFixture(deployEscrowFixture);
    const amount = 5n * ONE_USDT;

    await usdt.connect(investor).approve(await escrow.getAddress(), amount);
    await escrow.connect(investor).deposit(INTENT, amount);

    await expect(escrow.connect(owner).refund(INTENT, investor.address, amount))
      .to.emit(escrow, 'Refunded')
      .withArgs(INTENT, investor.address, amount);
    expect(await usdt.balanceOf(investor.address)).to.equal(20n * ONE_USDT);
  });

  it('attributes a deposit to the investor when a forwarder relays it', async () => {
    const { investor, relayer, forwarder, usdt, escrow } = await loadFixture(deployEscrowFixture);
    const amount = 5n * ONE_USDT;
    const escrowAddress = await escrow.getAddress();

    await usdt.connect(investor).approve(escrowAddress, amount);

    const data = encodeEscrowDeposit(INTENT, amount);
    const request = {
      from: investor.address,
      to: escrowAddress,
      value: 0,
      gas: 500_000,
      nonce: await forwarder.getNonce(investor.address),
      data,
    };

    const domain = forwarderDomain((await ethers.provider.getNetwork()).chainId, await forwarder.getAddress());
    const signature = await investor.signTypedData(domain, FORWARD_REQUEST_TYPES, request);

    await forwarder.connect(relayer).execute(request, signature);

    expect(await escrow.intentPayer(INTENT)).to.equal(investor.address);
    expect(await usdt.balanceOf(escrowAddress)).to.equal(amount);
  });
});
