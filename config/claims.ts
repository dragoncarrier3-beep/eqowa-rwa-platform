import { AbiCoder, getAddress, getBytes, hexlify, keccak256, toUtf8Bytes } from 'ethers';

import { CLAIM_TOPIC_KYC, CLAIM_TOPIC_RESIDENCY } from './eqowa';

/** ECDSA scheme used by ONCHAINID / T-REX claim verification. */
export const CLAIM_SCHEME_ECDSA = 1;

/** Claim payload written onto investor identities after a GREEN Sumsub review. */
export const CLAIM_DATA = hexlify(toUtf8Bytes('Verified by Eqowa compliance.'));

export const ISSUED_CLAIM_TOPICS = [CLAIM_TOPIC_KYC, CLAIM_TOPIC_RESIDENCY] as const;

export type ClaimSigner = {
  signMessage: (message: Uint8Array) => Promise<string>;
};

/** ONCHAINID claim digest: keccak256(abi.encode(identity, topic, data)). */
export function claimDigest(identityAddress: string, topic: bigint, data: string = CLAIM_DATA): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'bytes'], [getAddress(identityAddress), topic, data]),
  );
}

/** Sign a claim the way Identity.addClaim expects (eth_sign of the digest bytes). */
export async function signClaim(
  signer: ClaimSigner,
  identityAddress: string,
  topic: bigint,
  data: string = CLAIM_DATA,
): Promise<string> {
  return signer.signMessage(getBytes(claimDigest(identityAddress, topic, data)));
}

/**
 * Deterministic stand-in ONCHAINID while Amoy is not deployed.
 * Replaced by a real Identity proxy when the registry addresses are set.
 */
export function mockOnchainId(wallet: string): string {
  const hash = keccak256(toUtf8Bytes(`eqowa-mock-onchainid:${wallet.toLowerCase()}`));
  return getAddress(`0x${hash.slice(-40)}`);
}
