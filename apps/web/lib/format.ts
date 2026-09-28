/** Display helpers for 6-decimal EQOWAG and USDT base units. */

const DECIMALS = 6n;
const ONE = 10n ** DECIMALS;

/** "20003" from 20003000000n base units, with thousands separators and no trailing zeros. */
export function formatUnits6(baseUnits: bigint, maxFraction = 2): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const whole = abs / ONE;
  const fraction = abs % ONE;
  const wholeText = whole.toLocaleString('en-US');
  if (fraction === 0n || maxFraction === 0) {
    return `${negative ? '-' : ''}${wholeText}`;
  }
  const fractionText = fraction.toString().padStart(6, '0').slice(0, maxFraction).replace(/0+$/, '');
  return `${negative ? '-' : ''}${wholeText}${fractionText ? `.${fractionText}` : ''}`;
}

/** "0x1234...abcd" for tables and badges. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}
