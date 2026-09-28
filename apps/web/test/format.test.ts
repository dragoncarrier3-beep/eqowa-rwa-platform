import { formatUnits6, shortAddress } from '@/lib/format';

describe('formatUnits6', () => {
  it('formats whole share and USDT amounts with separators', () => {
    expect(formatUnits6(20_003_000_000n)).toBe('20,003');
    expect(formatUnits6(5_000_000n)).toBe('5');
    expect(formatUnits6(0n)).toBe('0');
  });

  it('keeps up to two decimals and drops trailing zeros', () => {
    expect(formatUnits6(2_500_000n)).toBe('2.5');
    expect(formatUnits6(2_123_456n)).toBe('2.12');
    expect(formatUnits6(2_100_000n, 6)).toBe('2.1');
    expect(formatUnits6(-7_000_000n)).toBe('-7');
  });
});

describe('shortAddress', () => {
  it('shortens long addresses only', () => {
    expect(shortAddress('0x1111111111111111111111111111111111111111')).toBe('0x1111...1111');
    expect(shortAddress('0xabc')).toBe('0xabc');
  });
});
