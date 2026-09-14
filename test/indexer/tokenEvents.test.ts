import { expect } from 'chai';
import { ZeroAddress } from 'ethers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ethers } from 'hardhat';

import { ONE_SHARE } from '../../config/eqowa';
import { decodeTokenLogs } from '../../config/tokenEvents';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

describe('token event decode against the live T-REX suite', () => {
  it('reads Transfer from mint and AddressFrozen from setAddressFrozen', async () => {
    const { accounts, suite } = await loadFixture(deployEqowaSuiteFixture);
    const tokenAddress = await suite.token.getAddress();
    const fromBlock = await ethers.provider.getBlockNumber();

    await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, 10n * ONE_SHARE);
    await suite.token.connect(accounts.alice).transfer(accounts.bob.address, ONE_SHARE);
    await suite.token.connect(accounts.tokenAgent).setAddressFrozen(accounts.alice.address, true);

    const logs = await ethers.provider.getLogs({
      address: tokenAddress,
      fromBlock,
      toBlock: 'latest',
    });
    const events = decodeTokenLogs(logs);

    const mint = events.find((event) => event.eventName === 'Transfer' && event.fromAddress === ZeroAddress);
    const transfer = events.find(
      (event) =>
        event.eventName === 'Transfer' &&
        event.fromAddress === accounts.alice.address &&
        event.toAddress === accounts.bob.address,
    );
    const frozen = events.find((event) => event.eventName === 'AddressFrozen');

    expect(mint?.amount).to.equal(10n * ONE_SHARE);
    expect(transfer?.amount).to.equal(ONE_SHARE);
    expect(frozen?.fromAddress).to.equal(accounts.alice.address);
    expect(frozen?.frozen).to.equal(true);
  });
});
