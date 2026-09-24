import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, mine } from '@nomicfoundation/hardhat-network-helpers';

import { ONE_SHARE, ONE_USDT, shareBaseUnits, splitUsdtDeposit } from '../../config/eqowa';
import { CONFIRMATION_BLOCKS, evaluateMint } from '../../config/mint';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';
import { deployEqowaSuiteFixture } from '../fixtures/deployEqowaSuite';

const INTENT = ethers.id('m2-05-intent');

async function deployPaymentFixture() {
  const suite = await deployEqowaSuiteFixture();
  const [owner] = await ethers.getSigners();
  const { usdt, escrow } = await deploySettlementContracts({ deployer: owner, owner: owner.address });

  const amount = 10n * ONE_USDT;
  await usdt.mint(suite.accounts.alice.address, amount);
  await usdt.connect(suite.accounts.alice).approve(await escrow.getAddress(), amount);

  return { ...suite, usdt, escrow, amount };
}

describe('payment-to-mint on the T-REX suite', () => {
  it('mints two shares after a 10 USDT escrow deposit and 12 confirmations', async () => {
    const { accounts, suite, escrow, amount } = await loadFixture(deployPaymentFixture);
    const split = splitUsdtDeposit(amount);
    expect(split.shares).to.equal(2n);

    await escrow.connect(accounts.alice).deposit(INTENT, amount);
    const depositBlock = await ethers.provider.getBlockNumber();

    const waiting = evaluateMint({
      quote: {
        intentId: INTENT,
        wallet: accounts.alice.address,
        usdtAmount: amount,
        shares: split.shares,
        shareAmount: shareBaseUnits(split.shares),
        fundsAmount: split.funds,
        feeAmount: split.fee,
        remainderAmount: split.remainder,
        quoteExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        status: 'deposited',
      },
      deposit: {
        intentId: INTENT,
        payerAddress: accounts.alice.address,
        tokenAddress: await escrow.USDT(),
        amount,
        txHash: INTENT,
        blockNumber: depositBlock,
        recordedAt: new Date(),
      },
      kycApproved: true,
      now: new Date(),
      currentBlock: depositBlock + CONFIRMATION_BLOCKS - 1,
    });
    expect(waiting.action).to.equal('wait');

    await mine(CONFIRMATION_BLOCKS);
    await suite.token.connect(accounts.tokenAgent).mint(accounts.alice.address, shareBaseUnits(split.shares));

    expect(await suite.token.balanceOf(accounts.alice.address)).to.equal(2n * ONE_SHARE);
    expect(await escrow.intentPayer(INTENT)).to.equal(accounts.alice.address);
  });
});
