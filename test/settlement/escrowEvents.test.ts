import { expect } from 'chai';
import { ethers } from 'hardhat';

import { ONE_USDT } from '../../config/eqowa';
import { DEPOSITED_TOPIC, decodeEscrowDepositLogs } from '../../config/escrowEvents';
import { encodeEscrowDeposit, FORWARD_REQUEST_TYPES, forwarderDomain } from '../../config/forwarder';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';

describe('escrow Deposited decoding', () => {
  it('decodes direct and relayed deposits exactly as the worker filters them', async () => {
    const [deployer, safe, investor, relayer] = await ethers.getSigners();
    const { usdt, forwarder, escrow, record } = await deploySettlementContracts({ deployer, owner: safe.address });
    const escrowAddress = await escrow.getAddress();
    await usdt.mint(investor.address, 20n * ONE_USDT);
    await usdt.connect(investor).approve(escrowAddress, 20n * ONE_USDT);

    const direct = ethers.id('direct');
    await escrow.connect(investor).deposit(direct, 5n * ONE_USDT);

    const relayed = ethers.id('relayed');
    const request = {
      from: investor.address,
      to: escrowAddress,
      value: 0n,
      gas: 500_000n,
      nonce: await forwarder.getNonce(investor.address),
      data: encodeEscrowDeposit(relayed, 10n * ONE_USDT),
    };
    const { chainId } = await ethers.provider.getNetwork();
    const signature = await investor.signTypedData(
      forwarderDomain(chainId, await forwarder.getAddress()),
      FORWARD_REQUEST_TYPES,
      request,
    );
    await forwarder.connect(relayer).execute(request, signature);

    // Same filter the worker sends: escrow address plus the Deposited topic.
    const logs = await ethers.provider.getLogs({
      address: escrowAddress,
      topics: [DEPOSITED_TOPIC],
      fromBlock: record.escrowDeployBlock,
      toBlock: 'latest',
    });
    const events = decodeEscrowDepositLogs(logs);

    expect(events).to.have.length(2);
    expect(events[0]).to.include({ intentId: direct, payer: investor.address, amount: 5n * ONE_USDT });
    expect(events[1]).to.include({ intentId: relayed, payer: investor.address, amount: 10n * ONE_USDT });
    expect(events[1]!.token).to.equal(await usdt.getAddress());
    expect(events[1]!.blockNumber).to.be.greaterThan(events[0]!.blockNumber);
  });

  it('ignores logs that are not Deposited', async () => {
    const [deployer, safe] = await ethers.getSigners();
    const { usdt } = await deploySettlementContracts({ deployer, owner: safe.address });
    await usdt.mint(deployer.address, ONE_USDT);

    const logs = await ethers.provider.getLogs({ address: await usdt.getAddress(), fromBlock: 0, toBlock: 'latest' });

    expect(logs.length).to.be.greaterThan(0);
    expect(decodeEscrowDepositLogs(logs)).to.deep.equal([]);
  });
});
