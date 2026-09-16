import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import Fastify, { type FastifyRequest } from 'fastify';
import pg from 'pg';

import { applySumsubWebhook, type ApplicantLookup } from './kyc/applyKyc.ts';
import { MemoryIdentityStore, type IdentityStore } from './kyc/identityStore.ts';
import { PgIdentityStore } from './kyc/pgIdentityStore.ts';
import { fetchSumsubApplicant } from './kyc/sumsubClient.ts';
import { verifySumsubDigest } from './kyc/sumsubSignature.ts';
import { MemoryMintStore, type MintStore } from './mint/mintStore.ts';
import { createMintQuote, recordMintDeposit, settleMintQuote } from './mint/pipeline.ts';
import { PgMintStore } from './mint/pgMintStore.ts';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

type RequestWithRawBody = FastifyRequest & { rawBody?: string };

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export type AppDeps = {
  webhookSecret?: string;
  identityStore?: IdentityStore;
  mintStore?: MintStore;
  lookupApplicant?: ApplicantLookup;
  now?: () => Date;
};

export function buildApp(deps: AppDeps = {}) {
  const app = Fastify({ logger: true });
  const webhookSecret = deps.webhookSecret ?? process.env.SUMSUB_WEBHOOK_SECRET ?? '';
  const store = deps.identityStore ?? new MemoryIdentityStore();
  const mintStore = deps.mintStore ?? new MemoryMintStore();
  const lookupApplicant = deps.lookupApplicant;
  const now = deps.now ?? (() => new Date());

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : Buffer.from(body as ArrayBuffer).toString('utf8');
    (request as RequestWithRawBody).rawBody = raw;
    try {
      const json = raw.length === 0 ? {} : JSON.parse(raw);
      done(null, json);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get('/health', async () => ({ ok: true, service: 'eqowa-api' }));

  app.get('/ready', async (_request, reply) => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(503).send({ ok: false, reason: 'DATABASE_URL is not set' });
    }

    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { ok: true };
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        reason: error instanceof Error ? error.message : 'database unreachable',
      });
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  app.post('/webhooks/sumsub', { logLevel: 'warn' }, async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const digestHeader = request.headers['x-payload-digest'];
    const algHeader = request.headers['x-payload-digest-alg'];
    const digest = typeof digestHeader === 'string' ? digestHeader : undefined;
    const alg = typeof algHeader === 'string' ? algHeader : undefined;

    if (!verifySumsubDigest({ rawBody, secret: webhookSecret, digest, alg })) {
      return reply.code(401).send({ ok: false, reason: 'invalid signature' });
    }

    const result = await applySumsubWebhook({
      payload: request.body,
      store,
      lookupApplicant,
    });

    return {
      ok: true,
      status: result.status,
      reason: result.reason,
      onchainId: result.identity?.onchainIdAddress,
      countryCode: result.identity?.countryCode ?? null,
      claims: result.identity?.claims ?? [],
    };
  });

  app.post('/mint/quotes', async (request, reply) => {
    const body = asRecord(request.body);
    const result = await createMintQuote({
      input: { wallet: asString(body.wallet), usdtAmount: asString(body.usdtAmount) },
      store: mintStore,
      now: now(),
    });
    if ('error' in result) {
      return reply.code(400).send({ ok: false, reason: result.error });
    }
    return { ok: true, quote: result.quote };
  });

  app.post('/mint/deposits', async (request, reply) => {
    const body = asRecord(request.body);
    const result = await recordMintDeposit({
      input: {
        intentId: asString(body.intentId),
        payerAddress: asString(body.payerAddress),
        tokenAddress: asString(body.tokenAddress),
        amount: asString(body.amount),
        txHash: asString(body.txHash),
        blockNumber: typeof body.blockNumber === 'number' ? body.blockNumber : Number.NaN,
      },
      store: mintStore,
      now: now(),
    });
    if ('error' in result) {
      return reply.code(result.error === 'unknown_intent' ? 404 : 400).send({ ok: false, reason: result.error });
    }
    return {
      ok: true,
      duplicate: result.duplicate,
      deposit: result.deposit
        ? {
            intentId: result.deposit.intentId,
            payerAddress: result.deposit.payerAddress,
            amount: result.deposit.amount.toString(),
            blockNumber: result.deposit.blockNumber,
          }
        : null,
    };
  });

  app.post('/mint/settle', async (request, reply) => {
    const body = asRecord(request.body);
    const currentBlock = typeof body.currentBlock === 'number' ? body.currentBlock : Number.NaN;
    if (!Number.isInteger(currentBlock) || currentBlock < 0) {
      return reply.code(400).send({ ok: false, reason: 'invalid_block' });
    }

    const result = await settleMintQuote({
      intentId: asString(body.intentId),
      store: mintStore,
      identities: store,
      now: now(),
      currentBlock,
    });
    if ('error' in result) {
      return reply.code(404).send({ ok: false, reason: result.error });
    }
    return { ok: true, quote: result.quote, decision: result.decision };
  });

  return app;
}

async function main() {
  let store: IdentityStore = new MemoryIdentityStore();
  let mintStore: MintStore = new MemoryMintStore();
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    store = new PgIdentityStore(pool);
    mintStore = new PgMintStore(pool);
  }

  const app = buildApp({
    identityStore: store,
    mintStore,
    lookupApplicant: (applicantId) => fetchSumsubApplicant(applicantId),
  });
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
