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
 * Maximum mintable across the whole token within any rolling 24 hours.
 * Global rather than per investor, so it bounds total issuance velocity and
 * contains the damage from a batch-minting error or a compromised agent key.
 */
export const DAILY_MINT_CAP = 250_000n * ONE_SHARE;

/**
 * ISO 3166-1 numeric codes used by tests when registering identities.
 * The production allow-list lives in `config/countries.ts`.
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

export {
  AFRICAN_UNION_COUNTRIES,
  ALLOWED_COUNTRIES,
  COUNTRY_ALLOW_BATCH_SIZE,
  EU27_COUNTRIES,
  chunkCountries,
} from './countries';
