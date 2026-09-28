import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ChainReader } from '../assets/catalog.ts';
import { readSession, type AuthConfig } from '../auth/routes.ts';
import type { Session } from '../auth/session.ts';
import type { MintStore } from '../mint/mintStore.ts';

import { readPortfolio } from './portfolio.ts';
import { toInvestorQuote } from './quotes.ts';

export type InvestorRouteDeps = {
  auth?: AuthConfig;
  mintStore: MintStore;
  /** Unset makes the portfolio 503 and leaves quote confirmations null. */
  chain?: ChainReader;
  chainId: number;
  tokenAddress: string;
  lockupModule?: string;
  now: () => Date;
};

const QUOTE_LIST_LIMIT = 50;

export function registerInvestorRoutes(app: FastifyInstance, deps: InvestorRouteDeps) {
  /** The session, or null after the reply has been sent. */
  function requireInvestor(request: FastifyRequest, reply: FastifyReply): Session | null {
    if (!deps.auth) {
      void reply.code(503).send({ ok: false, reason: 'auth_unconfigured' });
      return null;
    }
    const session = readSession(request, deps.auth, deps.now());
    if (!session) {
      void reply.code(401).send({ ok: false, reason: 'unauthenticated' });
      return null;
    }
    return session;
  }

  async function currentBlock(request: FastifyRequest) {
    if (!deps.chain) {
      return null;
    }
    try {
      return await deps.chain.getBlockNumber();
    } catch (error) {
      request.log.warn({ err: error }, 'chain head unavailable');
      return null;
    }
  }

  app.get('/investor/portfolio', async (request, reply) => {
    const session = requireInvestor(request, reply);
    if (!session) {
      return reply;
    }
    if (!deps.chain || !deps.tokenAddress) {
      return reply.code(503).send({ ok: false, reason: 'portfolio_unavailable' });
    }
    try {
      return await readPortfolio({
        chain: deps.chain,
        chainId: deps.chainId,
        tokenAddress: deps.tokenAddress,
        lockupModule: deps.lockupModule,
        walletAddress: session.walletAddress,
        now: deps.now(),
      });
    } catch (error) {
      request.log.error({ err: error }, 'portfolio read failed');
      return reply.code(503).send({ ok: false, reason: 'chain_unavailable' });
    }
  });

  app.get('/investor/quotes', async (request, reply) => {
    const session = requireInvestor(request, reply);
    if (!session) {
      return reply;
    }
    const [quotes, head] = await Promise.all([
      deps.mintStore.listQuotesByWallet(session.walletAddress, QUOTE_LIST_LIMIT),
      currentBlock(request),
    ]);
    const deposits = await Promise.all(quotes.map((quote) => deps.mintStore.getDeposit(quote.intentId)));
    return {
      ok: true,
      currentBlock: head,
      quotes: quotes.map((quote, index) => toInvestorQuote(quote, deposits[index], head)),
    };
  });

  app.get('/investor/quotes/:intentId', async (request, reply) => {
    const session = requireInvestor(request, reply);
    if (!session) {
      return reply;
    }
    const { intentId } = request.params as { intentId: string };
    const quote = await deps.mintStore.getQuote(intentId);
    // Another investor's quote answers the same as a missing one.
    if (!quote || quote.wallet.toLowerCase() !== session.walletAddress.toLowerCase()) {
      return reply.code(404).send({ ok: false, reason: 'unknown_intent' });
    }
    const [deposit, head] = await Promise.all([deps.mintStore.getDeposit(intentId), currentBlock(request)]);
    return { ok: true, currentBlock: head, quote: toInvestorQuote(quote, deposit, head) };
  });
}
