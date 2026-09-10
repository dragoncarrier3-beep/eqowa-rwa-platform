/**
 * Addresses confirmed by Eqowa for Milestone 1 on Polygon Amoy.
 *
 * Public addresses only. Private keys stay in `.env` and are never committed.
 */

/** Pays gas for the Amoy deploy. Must not be a Safe signer. */
export const DEPLOYER_ADDRESS = '0xbc21a3Bbe16A830834E6C3a069098AB11852e71C';

/** AGENT_ROLE hot wallet. Mints and registers investors. Must not be a Safe signer. */
export const AGENT_WALLET_ADDRESS = '0xbbE038AA2406199FA565f58bbcfE2Fabaa0E6a26';

/**
 * 2-of-3 Safe owners, confirmed 10 September 2026.
 * Admin / Compliance / Testnet 2. Deployer and Fintech Ops are deliberately absent.
 */
export const AMOY_SAFE_OWNERS = [
  '0x50D22edFE63F2fCF012125A5E50640eE5a6cD196',
  '0x10840351E6cC06f153931023E98C5895e60026dD',
  '0x7C568dd505DFeDf60BA29Ae1245f642fB1d6156c',
] as const;

export const AMOY_SAFE_THRESHOLD = 2;

/**
 * Filled after `scripts/createSafe.ts` runs on Amoy.
 * Until then the deploy script must refuse to transfer ownership.
 */
export const AMOY_SAFE_ADDRESS = process.env.GNOSIS_SAFE_ADDRESS ?? '';

/**
 * Official Safe 1.4.1 singleton deployments, used on Amoy (chain 80002).
 * https://github.com/safe-global/safe-deployments
 */
export const SAFE_V141 = {
  proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  safeL2: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  fallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
} as const;
