import { createSiweMessage } from 'viem/siwe';

import type { ApiError, NonceResponse, SessionDto, SessionResponse } from '@config/api';
import { TERMS_DOCUMENTS, consentStatement } from '@config/terms';

/** Browser path of an API route through the same-origin proxy. */
export function proxied(route: string) {
  return `/api${route}`;
}

export class SignInError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const REASON_TEXT: Record<string, string> = {
  wrong_domain: 'This sign-in request was not made for this site.',
  wrong_chain: 'Your wallet is on a different network.',
  message_expired: 'The sign-in request expired. Please try again.',
  invalid_signature: 'The signature did not match the connected wallet.',
  invalid_nonce: 'The sign-in request was already used or expired. Please try again.',
  auth_unconfigured: 'Sign-in is not available yet.',
  api_unreachable: 'The platform is not reachable. Please try again shortly.',
};

export function signInErrorText(error: unknown): string {
  if (error instanceof SignInError) {
    return REASON_TEXT[error.reason] ?? 'Sign-in failed. Please try again.';
  }
  // Wallets throw a UserRejectedRequestError when the user closes the prompt.
  if (error instanceof Error && /rejected|denied/i.test(error.message)) {
    return 'Sign-in was cancelled in the wallet.';
  }
  return 'Sign-in failed. Please try again.';
}

async function readJson<T>(response: Response): Promise<T | ApiError> {
  try {
    return (await response.json()) as T | ApiError;
  } catch {
    return { ok: false, reason: 'api_unreachable' };
  }
}

/**
 * Sign-In with Ethereum: fetch a single-use nonce, have the wallet sign an
 * EIP-4361 message for this host and chain, and trade it for a session cookie.
 * The wallet shows the host, so a look-alike site cannot reuse the signature.
 */
export async function signInWithEthereum(input: {
  address: `0x${string}`;
  chainId: number;
  signMessage: (args: { message: string }) => Promise<`0x${string}`>;
  location?: Pick<Location, 'host' | 'origin'>;
  now?: Date;
}): Promise<SessionDto> {
  const location = input.location ?? window.location;
  const nonceBody = await readJson<NonceResponse>(await fetch(proxied('/auth/siwe/nonce'), { cache: 'no-store' }));
  if (!nonceBody.ok) {
    throw new SignInError(nonceBody.reason);
  }

  const now = input.now ?? new Date();
  const message = createSiweMessage({
    address: input.address,
    chainId: input.chainId,
    domain: location.host,
    uri: location.origin,
    version: '1',
    nonce: nonceBody.nonce,
    issuedAt: now,
    expirationTime: new Date(nonceBody.expiresAt),
    // Signing this statement is the investor's acceptance of the terms.
    statement: consentStatement(),
    resources: TERMS_DOCUMENTS.map((doc) => `${location.origin}${doc.path}`),
  });
  const signature = await input.signMessage({ message });

  const verifyBody = await readJson<SessionResponse>(
    await fetch(proxied('/auth/siwe/verify'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    }),
  );
  if (!verifyBody.ok) {
    throw new SignInError(verifyBody.reason);
  }
  return verifyBody.session;
}

export async function fetchSession(): Promise<SessionDto | null> {
  const response = await fetch(proxied('/auth/me'), { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }
  const body = await readJson<SessionResponse>(response);
  return body.ok ? body.session : null;
}

export async function signOut(): Promise<void> {
  await fetch(proxied('/auth/logout'), { method: 'POST' });
}

export type WalletStage = 'disconnected' | 'wrong_network' | 'needs_sign_in' | 'signed_in';

/** Which step the header wallet control shows. A session for another wallet does not count. */
export function walletStage(input: {
  isConnected: boolean;
  address: string | undefined;
  chainId: number | undefined;
  expectedChainId: number;
  session: SessionDto | null | undefined;
}): WalletStage {
  if (!input.isConnected || !input.address) {
    return 'disconnected';
  }
  if (input.chainId !== input.expectedChainId) {
    return 'wrong_network';
  }
  if (!input.session || input.session.walletAddress.toLowerCase() !== input.address.toLowerCase()) {
    return 'needs_sign_in';
  }
  return 'signed_in';
}
