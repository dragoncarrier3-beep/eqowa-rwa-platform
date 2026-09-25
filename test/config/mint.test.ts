import { expect } from 'chai';

import { ONE_SHARE, ONE_USDT, SHARE_PRICE_USDT, splitUsdtDeposit } from '../../config/eqowa';
import {
  CONFIRMATION_BLOCKS,
  QUOTE_TTL_SECONDS,
  SAFE_APPROVAL_THRESHOLD_USDT,
  buildQuote,
  evaluateMint,
  requiresSafeApproval,
} from '../../config/mint';

const WALLET = '0x1111111111111111111111111111111111111111';
const NOW = new Date('2026-09-15T12:00:00.000Z');

describe('payment-to-mint quote', () => {
  it('locks 5 USDT per share for 15 minutes', () => {
    const built = buildQuote({ wallet: WALLET, usdtAmount: 10n * ONE_USDT, now: NOW });
    expect('quote' in built).to.equal(true);
    if (!('quote' in built)) {
      return;
    }

    expect(built.quote.shares).to.equal(2n);
    expect(built.quote.shareAmount).to.equal(2n * ONE_SHARE);
    expect(built.quote.quoteExpiresAt.getTime()).to.equal(NOW.getTime() + QUOTE_TTL_SECONDS * 1000);
    expect(QUOTE_TTL_SECONDS).to.equal(15 * 60);
  });

  it('rejects a payment smaller than one share', () => {
    expect(buildQuote({ wallet: WALLET, usdtAmount: 4n * ONE_USDT, now: NOW })).to.deep.equal({
      error: 'below_share_price',
    });
  });
});

describe('Safe approval threshold', () => {
  it('holds mints of 100,000 USDT or more and lets smaller ones through', () => {
    expect(SAFE_APPROVAL_THRESHOLD_USDT).to.equal(100_000n * ONE_USDT);
    expect(requiresSafeApproval(100_000n * ONE_USDT - 1n)).to.equal(false);
    expect(requiresSafeApproval(100_000n * ONE_USDT)).to.equal(true);
    expect(requiresSafeApproval(250_000n * ONE_USDT)).to.equal(true);
  });
});

describe('payment-to-mint gates', () => {
  const built = buildQuote({ wallet: WALLET, usdtAmount: 10n * ONE_USDT, now: NOW });
  if (!('quote' in built)) {
    throw new Error('expected a quote');
  }
  const quote = built.quote;

  it('waits until the deposit is 12 blocks deep', () => {
    const deposit = {
      intentId: quote.intentId,
      payerAddress: WALLET,
      tokenAddress: WALLET,
      amount: 10n * ONE_USDT,
      txHash: '0x1',
      blockNumber: 100,
      recordedAt: NOW,
    };

    expect(evaluateMint({ quote, deposit, kycApproved: true, now: NOW, currentBlock: 111 })).to.deep.equal({
      action: 'wait',
      reason: 'awaiting_confirmations',
      confirmations: 11,
    });

    const ready = evaluateMint({
      quote,
      deposit,
      kycApproved: true,
      now: NOW,
      currentBlock: 100 + CONFIRMATION_BLOCKS,
    });
    expect(ready.action).to.equal('mint');
    if (ready.action === 'mint') {
      expect(ready.shareAmount).to.equal(2n * ONE_SHARE);
    }
  });

  it('expires a quote with no deposit after 15 minutes', () => {
    expect(
      evaluateMint({
        quote,
        kycApproved: true,
        now: new Date(NOW.getTime() + QUOTE_TTL_SECONDS * 1000 + 1),
        currentBlock: 1,
      }),
    ).to.deep.equal({ action: 'expire', reason: 'quote_expired' });
  });

  it('keeps leftover USDT out of the minted share amount', () => {
    const split = splitUsdtDeposit(7n * ONE_USDT);
    expect(split.shares).to.equal(1n);
    expect(split.remainder).to.equal(2n * ONE_USDT);
    expect(SHARE_PRICE_USDT).to.equal(5n * ONE_USDT);
  });
});
