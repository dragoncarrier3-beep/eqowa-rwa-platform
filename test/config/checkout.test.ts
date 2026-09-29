import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import { approvalTypedData, depositTypedData, encodeApproveCall, encodeDepositCall } from '../../config/checkout';
import { ONE_USDT } from '../../config/eqowa';
import { ESCROW_IFACE } from '../../config/forwarder';
import { USDT_META_IFACE, relayEscrowDeposit, relayUsdtApproval } from '../../config/relayer';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';

/** ethers needs mutable arrays; the builders return readonly ones for viem. */
function mutableTypes(types: Record<string, readonly { name: string; type: string }[]>) {
  return Object.fromEntries(Object.entries(types).map(([key, fields]) => [key, [...fields]]));
}

async function deployFixture() {
  const [owner, alice, relayer] = await ethers.getSigners();
  const { forwarder, usdt, escrow } = await deploySettlementContracts({ deployer: owner, owner: owner.address });
  await usdt.mint(alice.address, 50n * ONE_USDT);
  return {
    alice,
    relayer,
    forwarder,
    usdt,
    escrow,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    addresses: {
      usdt: await usdt.getAddress(),
      escrow: await escrow.getAddress(),
      forwarder: await forwarder.getAddress(),
    },
  };
}

describe('checkout typed data (shared by web and API)', () => {
  it('hand-encodes approve and deposit exactly like ethers', () => {
    const spender = '0x2222222222222222222222222222222222222222';
    const intent = ethers.id('intent');
    expect(encodeApproveCall(spender, 7n * ONE_USDT)).to.equal(
      USDT_META_IFACE.encodeFunctionData('approve', [spender, 7n * ONE_USDT]),
    );
    expect(encodeDepositCall(intent, 7n * ONE_USDT)).to.equal(
      ESCROW_IFACE.encodeFunctionData('deposit', [intent, 7n * ONE_USDT]),
    );
    expect(() => encodeApproveCall('0x1234', 1n)).to.throw('not an address');
    expect(() => encodeDepositCall('0xabc', 1n)).to.throw('not a bytes32');
  });

  it('signs an approval and a deposit the relayers accept, investor gas untouched', async () => {
    const { alice, relayer, usdt, forwarder, escrow, chainId, addresses } = await loadFixture(deployFixture);
    const amount = 10n * ONE_USDT;
    const intentId = ethers.id('checkout-e2e');
    const gasBefore = await ethers.provider.getBalance(alice.address);

    const approval = approvalTypedData({
      chainId,
      usdt: addresses.usdt,
      usdtName: await usdt.name(),
      escrow: addresses.escrow,
      from: alice.address,
      nonce: await usdt.getNonce(alice.address),
      amount,
    });
    const approvalSignature = await alice.signTypedData(
      approval.domain,
      mutableTypes(approval.types),
      approval.message,
    );
    await relayUsdtApproval({
      input: {
        from: alice.address,
        functionSignature: approval.message.functionSignature,
        signature: approvalSignature,
      },
      usdtAddress: addresses.usdt,
      escrowAddress: addresses.escrow,
      chainId: BigInt(chainId),
      relayer,
      expectedFrom: alice.address,
    });
    expect(await usdt.allowance(alice.address, addresses.escrow)).to.equal(amount);

    const deposit = depositTypedData({
      chainId,
      forwarder: addresses.forwarder,
      escrow: addresses.escrow,
      from: alice.address,
      nonce: await forwarder.getNonce(alice.address),
      intentId,
      amount,
    });
    const depositSignature = await alice.signTypedData(deposit.domain, mutableTypes(deposit.types), deposit.message);
    await relayEscrowDeposit({
      input: { request: deposit.message, signature: depositSignature },
      escrowAddress: addresses.escrow,
      forwarderAddress: addresses.forwarder,
      chainId: BigInt(chainId),
      relayer,
    });

    expect(await escrow.intentPayer(intentId)).to.equal(alice.address);
    expect(await usdt.balanceOf(addresses.escrow)).to.equal(amount);
    // Exactly the quoted amount was approved and used, nothing left open.
    expect(await usdt.allowance(alice.address, addresses.escrow)).to.equal(0n);
    expect(await ethers.provider.getBalance(alice.address)).to.equal(gasBefore);
  });
});
