import { expect } from 'chai';

import {
  FEE_PER_SHARE_USDT,
  FUNDS_PER_SHARE_USDT,
  ONE_SHARE,
  ONE_USDT,
  SHARE_PRICE_USDT,
  shareBaseUnits,
  splitUsdtDeposit,
} from '../../config/eqowa';

describe('EQOWAG share price', () => {
  it('is 5 USDT per share, split 4 funds and 1 fee', () => {
    expect(SHARE_PRICE_USDT).to.equal(5n * ONE_USDT);
    expect(FUNDS_PER_SHARE_USDT + FEE_PER_SHARE_USDT).to.equal(SHARE_PRICE_USDT);
  });

  it('mints one share from 5 USDT with no remainder', () => {
    const split = splitUsdtDeposit(5n * ONE_USDT);

    expect(split.shares).to.equal(1n);
    expect(split.funds).to.equal(4n * ONE_USDT);
    expect(split.fee).to.equal(1n * ONE_USDT);
    expect(split.remainder).to.equal(0n);
    expect(shareBaseUnits(split.shares)).to.equal(ONE_SHARE);
  });

  it('floors a partial payment and keeps the leftover as remainder', () => {
    const split = splitUsdtDeposit(7n * ONE_USDT);

    expect(split.shares).to.equal(1n);
    expect(split.remainder).to.equal(2n * ONE_USDT);
  });

  it('rejects a negative amount', () => {
    expect(() => splitUsdtDeposit(-1n)).to.throw('non-negative');
  });
});
