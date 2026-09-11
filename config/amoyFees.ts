/**
 * Amoy fee policy.
 *
 * The Amoy base fee sits at effectively zero, but `eth_gasPrice` reports the
 * priority fee that spam transactions happen to be paying, which has been seen
 * at 79 gwei. Taking that number at face value prices the deploy at over 3 POL
 * when 1.2 buys it, and test POL is hard to come by.
 *
 * So the price is pinned rather than suggested. Bor rejects transactions below
 * 25 gwei, so 30 leaves headroom without overpaying.
 */
export const AMOY_GAS_PRICE_GWEI = 30n;

export const AMOY_GAS_PRICE_WEI = AMOY_GAS_PRICE_GWEI * 1_000_000_000n;
