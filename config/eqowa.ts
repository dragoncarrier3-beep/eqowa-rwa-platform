/**
 * Token and compliance parameters for the EQOWA Group Shares offering.
 *
 * Values are taken from the Eqowa Fintech handover specification (GitHub issue
 * #2) and the client scope answers of 23 August and 8 September 2026. Tests and
 * deployment scripts both read from here so there is a single source of truth.
 */

export const TOKEN_NAME = 'EQOWA Group Shares';
export const TOKEN_SYMBOL = 'EQOWAG';
export const TOKEN_DECIMALS = 6;

/** One whole share expressed in base units. */
export const ONE_SHARE = 10n ** BigInt(TOKEN_DECIMALS);

/**
 * Claim topics an investor must hold before the identity registry considers
 * them verified. Both are issued by the Eqowa backend off the back of Sumsub.
 */
export const CLAIM_TOPIC_KYC = 1n;
export const CLAIM_TOPIC_RESIDENCY = 2n;
export const REQUIRED_CLAIM_TOPICS = [CLAIM_TOPIC_KYC, CLAIM_TOPIC_RESIDENCY];

/** Maximum shares a single ONCHAINID may hold. */
export const MAX_BALANCE = 150_000n * ONE_SHARE;

/** Maximum number of distinct holders permitted in Phase 1. */
export const MAX_HOLDER_COUNT = 500n;

/** Lock-up applied to each mint tranche, measured from that tranche's mint. */
export const LOCKUP_DURATION_SECONDS = 730n * 24n * 60n * 60n;

/**
 * ISO 3166-1 numeric country codes. T-REX stores an investor's country as a
 * uint16 on the identity registry and the compliance modules compare against
 * it. Only the subset needed by the test suite is listed here; the full
 * production allow-list is assembled in M1-07.
 */
export const COUNTRY = {
  NIGERIA: 566,
  GHANA: 288,
  KENYA: 404,
  SOUTH_AFRICA: 710,
  UNITED_KINGDOM: 826,
  GERMANY: 276,
  FRANCE: 250,
  UNITED_STATES: 840,
} as const;

/** Placeholder allow-list used by the test fixture. Superseded in M1-07. */
export const TEST_ALLOWED_COUNTRIES = [
  COUNTRY.NIGERIA,
  COUNTRY.GHANA,
  COUNTRY.KENYA,
  COUNTRY.SOUTH_AFRICA,
  COUNTRY.UNITED_KINGDOM,
  COUNTRY.GERMANY,
  COUNTRY.FRANCE,
];
