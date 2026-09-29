import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generateSiweNonce } from 'viem/siwe';

import type { InvestorMeResponse, SessionDto } from '../../../../config/api.ts';

import type { TokenLedgerStore } from '../indexer/ledger.ts';
import type { IdentityRecord, IdentityStore } from '../kyc/identityStore.ts';

import { NONCE_TTL_SECONDS, type NonceStore } from './nonceStore.ts';
import {
  INVESTOR_SESSION_SECONDS,
  parseCookies,
  serializeCookie,
  signSession,
  verifySession,
  type Session,
} from './session.ts';
import { verifySiweLogin } from './siwe.ts';

export type AuthConfig = {
  secret: string;
  cookieName: string;
  /** False only for plain-http local setups other than localhost. */
  secureCookie: boolean;
  siweDomain: string;
  chainId: number;
};

export type AuthRouteDeps = {
  /** Undefined turns every auth route into 503 auth_unconfigured. */
  auth?: AuthConfig;
  nonces: NonceStore;
  identities: IdentityStore;
  ledger?: TokenLedgerStore;
  tokenAddress: string;
  now: () => Date;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** What an investor sees of the on-chain step: deployed-but-unfinished is still pending. */
function registrationOf(identity: IdentityRecord): 'pending' | 'registered' | 'failed' {
  const status = identity.onchain?.status;
  return status === 'registered' || status === 'failed' ? status : 'pending';
}

function toDto(session: Session): SessionDto {
  return { kind: session.kind, walletAddress: session.walletAddress, expiresAt: session.expiresAt.toISOString() };
}

/** The signed-in investor, or null. Exported for the investor routes of later slices. */
export function readSession(request: FastifyRequest, auth: AuthConfig, now: Date): Session | null {
  const token = parseCookies(request.headers.cookie)[auth.cookieName];
  return token ? verifySession(token, auth.secret, now) : null;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps) {
  const unconfigured = (reply: FastifyReply) => reply.code(503).send({ ok: false, reason: 'auth_unconfigured' });

  app.get('/auth/siwe/nonce', async (_request, reply) => {
    if (!deps.auth) {
      return unconfigured(reply);
    }
    const now = deps.now();
    const nonce = generateSiweNonce();
    const expiresAt = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000);
    await deps.nonces.issue(nonce, expiresAt, now);
    // A nonce must never be served from a cache to a second visitor.
    reply.header('cache-control', 'no-store');
    return { ok: true, nonce, expiresAt: expiresAt.toISOString() };
  });

  app.post('/auth/siwe/verify', async (request, reply) => {
    const auth = deps.auth;
    if (!auth) {
      return unconfigured(reply);
    }
    const body = asRecord(request.body);
    const message = typeof body.message === 'string' ? body.message : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    if (!message || !signature) {
      return reply.code(400).send({ ok: false, reason: 'invalid_message' });
    }

    const now = deps.now();
    const result = await verifySiweLogin({
      message,
      signature,
      expected: { domain: auth.siweDomain, chainId: auth.chainId },
      nonces: deps.nonces,
      now,
    });
    if ('error' in result) {
      request.log.warn({ reason: result.error }, 'siwe sign-in rejected');
      return reply.code(401).send({ ok: false, reason: result.error });
    }

    const session: Session = {
      kind: 'investor',
      walletAddress: result.walletAddress,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + INVESTOR_SESSION_SECONDS * 1000),
    };
    reply.header(
      'set-cookie',
      serializeCookie(auth.cookieName, signSession(session, auth.secret), {
        maxAgeSeconds: INVESTOR_SESSION_SECONDS,
        secure: auth.secureCookie,
      }),
    );
    return { ok: true, session: toDto(session) };
  });

  app.get('/auth/me', async (request, reply) => {
    if (!deps.auth) {
      return unconfigured(reply);
    }
    const session = readSession(request, deps.auth, deps.now());
    if (!session) {
      return reply.code(401).send({ ok: false, reason: 'unauthenticated' });
    }
    return { ok: true, session: toDto(session) };
  });

  app.post('/auth/logout', async (_request, reply) => {
    if (!deps.auth) {
      return unconfigured(reply);
    }
    reply.header(
      'set-cookie',
      serializeCookie(deps.auth.cookieName, '', { maxAgeSeconds: 0, secure: deps.auth.secureCookie }),
    );
    return { ok: true };
  });

  app.get('/investor/me', async (request, reply) => {
    if (!deps.auth) {
      return unconfigured(reply);
    }
    const session = readSession(request, deps.auth, deps.now());
    if (!session) {
      return reply.code(401).send({ ok: false, reason: 'unauthenticated' });
    }

    const [identity, holding] = await Promise.all([
      deps.identities.getByWallet(session.walletAddress),
      deps.ledger && deps.tokenAddress ? deps.ledger.getBalance(deps.tokenAddress, session.walletAddress) : undefined,
    ]);
    const response: InvestorMeResponse = {
      ok: true,
      walletAddress: session.walletAddress,
      kyc: identity
        ? {
            status: identity.kycStatus,
            countryCode: identity.countryCode,
            onchainIdAddress: identity.onchain?.identityAddress ?? identity.onchainIdAddress,
            registration: registrationOf(identity),
          }
        : null,
      holding: holding
        ? { balance: holding.balance.toString(), frozen: holding.frozen, updatedBlock: holding.updatedBlock }
        : null,
    };
    return response;
  });
}
