import { getAddress, verifyMessage, type Hex } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';

import type { NonceStore } from './nonceStore.ts';

export type SiweExpectation = {
  /** Host the web app is served on, e.g. app.eqowa.com or localhost:3000. */
  domain: string;
  chainId: number;
};

export type SiweError =
  'invalid_message' | 'wrong_domain' | 'wrong_chain' | 'message_expired' | 'invalid_signature' | 'invalid_nonce';

/**
 * Checks an EIP-4361 sign-in. The message must name our domain and chain,
 * be inside its validity window, be signed by the address it names, and carry
 * a nonce we issued that has not been used. The nonce is spent last, so only
 * a fully valid sign-in uses it up.
 */
export async function verifySiweLogin(input: {
  message: string;
  signature: string;
  expected: SiweExpectation;
  nonces: NonceStore;
  now: Date;
}): Promise<{ walletAddress: string } | { error: SiweError }> {
  const parsed = parseSiweMessage(input.message);
  if (!parsed.address || !parsed.nonce || !parsed.domain || !parsed.uri || parsed.version !== '1' || !parsed.issuedAt) {
    return { error: 'invalid_message' };
  }
  if (parsed.domain !== input.expected.domain) {
    return { error: 'wrong_domain' };
  }
  let uriHost: string;
  try {
    uriHost = new URL(parsed.uri).host;
  } catch {
    return { error: 'invalid_message' };
  }
  if (uriHost !== input.expected.domain) {
    return { error: 'wrong_domain' };
  }
  if (parsed.chainId !== input.expected.chainId) {
    return { error: 'wrong_chain' };
  }
  if (!validateSiweMessage({ message: parsed, domain: input.expected.domain, time: input.now })) {
    return { error: 'message_expired' };
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: parsed.address,
      message: input.message,
      signature: input.signature as Hex,
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    return { error: 'invalid_signature' };
  }

  if (!(await input.nonces.consume(parsed.nonce, input.now))) {
    return { error: 'invalid_nonce' };
  }
  return { walletAddress: getAddress(parsed.address) };
}
