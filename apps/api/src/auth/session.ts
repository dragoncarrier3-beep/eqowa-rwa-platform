import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless sessions: an HS256 JWT in an HttpOnly cookie. Investors sign in
 * with their wallet only (SIWE); admin sessions arrive with WebAuthn in M4-08
 * and reuse this with kind 'admin'.
 */

export type SessionKind = 'investor';

export type Session = {
  kind: SessionKind;
  walletAddress: string;
  issuedAt: Date;
  expiresAt: Date;
};

export const INVESTOR_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const MIN_SECRET_LENGTH = 32;

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function hmac(secret: string, data: string) {
  return createHmac('sha256', secret).update(data).digest();
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signSession(session: Session, secret: string): string {
  const payload = base64url(
    JSON.stringify({
      sub: session.walletAddress,
      kind: session.kind,
      iat: Math.floor(session.issuedAt.getTime() / 1000),
      exp: Math.floor(session.expiresAt.getTime() / 1000),
    }),
  );
  const body = `${HEADER}.${payload}`;
  return `${body}.${base64url(hmac(secret, body))}`;
}

/** Null for anything but an unexpired token this secret signed. */
export function verifySession(token: string, secret: string, now: Date): Session | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) {
    return null;
  }
  const expected = hmac(secret, `${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.kind !== 'investor' || typeof claims.sub !== 'string') {
    return null;
  }
  if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) {
    return null;
  }
  return {
    kind: claims.kind,
    walletAddress: claims.sub,
    issuedAt: new Date(claims.iat * 1000),
    expiresAt: new Date(claims.exp * 1000),
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export type CookieOptions = { maxAgeSeconds: number; secure: boolean };

/** HttpOnly so page scripts cannot read it, SameSite=Lax so other sites cannot post with it. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
