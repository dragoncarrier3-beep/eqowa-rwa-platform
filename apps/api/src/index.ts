import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isAddress } from 'ethers';
import Fastify, { type FastifyRequest } from 'fastify';
import pg from 'pg';

import {
  adminUnauthorized,
  serializeAudit,
  serializeException,
  serializeIdentity,
  serializeKycEvent,
} from './admin/serialize.ts';
import type { AssetCatalog } from './assets/catalog.ts';
import { applySumsubWebhook, type ApplicantLookup } from './kyc/applyKyc.ts';
import { MemoryIdentityStore, type IdentityRecord, type IdentityStore } from './kyc/identityStore.ts';
import { fetchSumsubApplicant } from './kyc/sumsubClient.ts';
import { verifySumsubDigest } from './kyc/sumsubSignature.ts';
import { MemoryMintStore, type MintStore } from './mint/mintStore.ts';
import {
  approveSafeMint,
  createMintQuote,
  recordMintDeposit,
  settleMintQuote,
  type MintExecutor,
} from './mint/pipeline.ts';
import { parseForwardRequest, relayEscrowDeposit } from './relayer/relayDeposit.ts';
import { createRelayerSigner } from './signer/fromEnv.ts';
import {
  createAssetCatalogFromEnv,
  createMintExecutor,
  createSettlementWorkerFromEnv,
  createStores,
  loadEnv,
  rpcProvider,
} from './bootstrap.ts';

loadEnv();

type RequestWithRawBody = FastifyRequest & { rawBody?: string };

/** HTTP status for each settle outcome that is not a decision. */
const SETTLE_ERROR_STATUS = {
  unknown_intent: 404,
  mint_unavailable: 503,
  mint_paused: 409,
  not_claimable: 409,
  not_minting: 409,
  mint_unconfirmed: 409,
  mint_pending: 202,
  mint_failed: 502,
} as const;

const KYC_STATUSES: IdentityRecord['kycStatus'][] = ['pending', 'approved', 'rejected', 'blocked_country'];

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
  mint?: MintExecutor;
  adminKey?: string;
  assets?: AssetCatalog;
  relayDeposit?: (input: {
    request: NonNullable<ReturnType<typeof parseForwardRequest>>;
    signature: string;
  }) => Promise<{ txHash: string; intentId: string; amount: bigint }>;
};

export function buildApp(deps: AppDeps = {}) {
  const app = Fastify({ logger: true });
  const webhookSecret = deps.webhookSecret ?? process.env.SUMSUB_WEBHOOK_SECRET ?? '';
  const store = deps.identityStore ?? new MemoryIdentityStore();
  const mintStore = deps.mintStore ?? new MemoryMintStore();
  const lookupApplicant = deps.lookupApplicant;
  const now = deps.now ?? (() => new Date());
  const mint = deps.mint;
  const relayDeposit = deps.relayDeposit;
  const adminKey = deps.adminKey ?? process.env.ADMIN_API_KEY ?? '';
  const assets = deps.assets;

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

  // Public: the landing page and asset page read live token figures here.
  app.get('/assets', async (request, reply) => {
    if (!assets) {
      return reply.code(503).send({ ok: false, reason: 'assets_unavailable' });
    }
    try {
      return { ok: true, assets: await assets.list() };
    } catch (error) {
      request.log.error({ err: error }, 'asset read failed');
      return reply.code(503).send({ ok: false, reason: 'chain_unavailable' });
    }
  });

  app.get('/assets/:token', async (request, reply) => {
    const params = request.params as { token: string };
    if (!isAddress(params.token)) {
      return reply.code(400).send({ ok: false, reason: 'invalid_address' });
    }
    if (!assets) {
      return reply.code(503).send({ ok: false, reason: 'assets_unavailable' });
    }
    try {
      const asset = await assets.get(params.token);
      if (!asset) {
        return reply.code(404).send({ ok: false, reason: 'unknown_asset' });
      }
      return { ok: true, asset };
    } catch (error) {
      request.log.error({ err: error }, 'asset read failed');
      return reply.code(503).send({ ok: false, reason: 'chain_unavailable' });
    }
  });

  app.post('/webhooks/sumsub', async (request, reply) => {
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const digestHeader = request.headers['x-payload-digest'];
    const algHeader = request.headers['x-payload-digest-alg'];
    const digest = typeof digestHeader === 'string' ? digestHeader : undefined;
    const alg = typeof algHeader === 'string' ? algHeader : undefined;

    if (!verifySumsubDigest({ rawBody, secret: webhookSecret, digest, alg })) {
      request.log.warn({ reason: 'invalid signature' }, 'sumsub webhook rejected');
      return reply.code(401).send({ ok: false, reason: 'invalid signature' });
    }

    const body = asRecord(request.body);
    const result = await applySumsubWebhook({
      payload: request.body,
      store,
      lookupApplicant,
    });

    const eventType = asString(body.type) || 'unknown';
    const applicantId = asString(body.applicantId) || 'unknown';
    const reviewAnswer = asString(asRecord(body.reviewResult).reviewAnswer) || null;

    // Every verified delivery is kept, including ignored types, so ops can
    // answer "did Sumsub reach us for this applicant" without Sumsub's own log.
    await store.recordEvent({
      applicantId,
      eventType,
      reviewAnswer,
      countryCode: result.identity?.countryCode ?? null,
      status: result.status,
      reason: result.reason ?? null,
      payload: body,
      receivedAt: now(),
    });

    request.log.info(
      {
        type: eventType,
        applicantId,
        status: result.status,
        reason: result.reason,
      },
      'sumsub webhook',
    );

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
      mint,
    });
    if ('error' in result) {
      return reply.code(SETTLE_ERROR_STATUS[result.error]).send({
        ok: false,
        reason: result.error,
        detail: 'reason' in result ? result.reason : undefined,
        quote: 'quote' in result ? result.quote : undefined,
      });
    }
    return { ok: true, quote: result.quote, decision: result.decision };
  });

  app.post('/relayer/deposit', async (request, reply) => {
    if (!relayDeposit) {
      return reply.code(503).send({ ok: false, reason: 'relayer_unavailable' });
    }

    const body = asRecord(request.body);
    const requestBody = asRecord(body.request);
    const parsed = parseForwardRequest(requestBody);
    const signature = asString(body.signature);
    if (!parsed || !signature) {
      return reply.code(400).send({ ok: false, reason: 'invalid_forward_request' });
    }

    try {
      const result = await relayDeposit({ request: parsed, signature });
      return {
        ok: true,
        txHash: result.txHash,
        intentId: result.intentId,
        amount: result.amount.toString(),
      };
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        reason: 'relay_rejected',
        detail: error instanceof Error ? error.message : 'relay failed',
      });
    }
  });

  app.get('/admin/exceptions', async (request, reply) => {
    const denied = adminUnauthorized(request, reply, adminKey);
    if (denied) {
      return denied;
    }
    const query = request.query as Record<string, unknown>;
    const status = query.status === 'open' || query.status === 'resolved' ? query.status : undefined;
    const intentId = typeof query.intentId === 'string' ? query.intentId : undefined;
    const rows = await mintStore.listExceptions({ status, intentId });
    return { ok: true, exceptions: rows.map(serializeException) };
  });

  app.post('/admin/exceptions/:id/resolve', async (request, reply) => {
    const denied = adminUnauthorized(request, reply, adminKey);
    if (denied) {
      return denied;
    }
    const params = request.params as { id: string };
    const body = asRecord(request.body);
    const actorHeader = request.headers['x-admin-actor'];
    const actor = typeof actorHeader === 'string' && actorHeader.trim() ? actorHeader.trim() : 'admin';
    const result = await mintStore.resolveException(params.id, {
      actor,
      resolution: asString(body.resolution),
      now: now(),
    });
    if (result === 'missing') {
      return reply.code(404).send({ ok: false, reason: 'unknown_exception' });
    }
    if (result === 'already_resolved') {
      return reply.code(409).send({ ok: false, reason: result });
    }
    if (typeof result === 'string') {
      return reply.code(400).send({ ok: false, reason: result });
    }
    return { ok: true, exception: serializeException(result) };
  });

  app.post('/admin/mint/:intentId/approve', async (request, reply) => {
    const denied = adminUnauthorized(request, reply, adminKey);
    if (denied) {
      return denied;
    }
    const params = request.params as { intentId: string };
    const body = asRecord(request.body);
    const actorHeader = request.headers['x-admin-actor'];
    const actor = typeof actorHeader === 'string' && actorHeader.trim() ? actorHeader.trim() : 'admin';
    const result = await approveSafeMint({
      intentId: params.intentId,
      store: mintStore,
      safeTxHash: asString(body.safeTxHash),
      actor,
      now: now(),
    });
    if ('error' in result) {
      const code = { invalid_safe_tx: 400, unknown_intent: 404, not_awaiting_approval: 409 }[result.error];
      return reply.code(code).send({ ok: false, reason: result.error });
    }
    return { ok: true, quote: result.quote };
  });

  app.get('/admin/kyc', async (request, reply) => {
    const denied = adminUnauthorized(request, reply, adminKey);
    if (denied) {
      return denied;
    }
    const query = request.query as Record<string, unknown>;
    const status = KYC_STATUSES.find((value) => value === query.status);
    const rows = await store.list({ status });
    return { ok: true, identities: rows.map(serializeIdentity) };
  });

  app.get('/admin/kyc/:applicantId', async (request, reply) => {
    const denied = adminUnauthorized(request, reply, adminKey);
    if (denied) {
      return denied;
    }
    const params = request.params as { applicantId: string };
    const [identity, events] = await Promise.all([
      store.getByApplicant(params.applicantId),
      store.listEvents(params.applicantId),
    ]);
    if (!identity && events.length === 0) {
      return reply.code(404).send({ ok: false, reason: 'unknown_applicant' });
    }
    return {
      ok: true,
      identity: identity ? serializeIdentity(identity) : null,
      events: events.map(serializeKycEvent),
    };
  });

  app.get('/admin/audit', async (request, reply) => {
    const denied = adminUnauthorized(request, reply, adminKey);
    if (denied) {
      return denied;
    }
    const query = request.query as Record<string, unknown>;
    const limit = typeof query.limit === 'string' ? Number(query.limit) : 50;
    const rows = await mintStore.listAudit(Number.isFinite(limit) ? limit : 50);
    return { ok: true, audit: rows.map(serializeAudit) };
  });

  return app;
}

function createRelayHandler(): AppDeps['relayDeposit'] {
  const provider = rpcProvider();
  const escrowAddress = process.env.ESCROW_ADDRESS;
  const forwarderAddress = process.env.FORWARDER_ADDRESS;
  if (!provider || !escrowAddress || !forwarderAddress) {
    return undefined;
  }

  const relayer = createRelayerSigner({ env: process.env, provider });
  if (!relayer) {
    return undefined;
  }

  const chainId = process.env.CHAIN_ID ? BigInt(process.env.CHAIN_ID) : 80002n;
  return (input) =>
    relayEscrowDeposit({
      input,
      escrowAddress,
      forwarderAddress,
      chainId,
      relayer,
    });
}

async function main() {
  const stores = createStores();

  const mint = createMintExecutor();
  if ('disabled' in mint) {
    console.warn(`Agent mint disabled: ${mint.disabled}`);
  }

  const assets = createAssetCatalogFromEnv();
  if ('disabled' in assets) {
    console.warn(`Asset listing off: ${assets.disabled}`);
  }

  const app = buildApp({
    assets: 'catalog' in assets ? assets.catalog : undefined,
    identityStore: stores.identities,
    mintStore: stores.mintStore,
    lookupApplicant: (applicantId) => fetchSumsubApplicant(applicantId),
    mint: 'executor' in mint ? mint.executor : undefined,
    relayDeposit: createRelayHandler(),
  });
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });

  // Runs in this process unless SETTLEMENT_WORKER=off, for example when the
  // standalone `npm run api:worker` is used instead.
  const settlement = createSettlementWorkerFromEnv(stores);
  if ('worker' in settlement) {
    settlement.worker.start();
  } else {
    app.log.warn(`Settlement worker off: ${settlement.disabled}`);
  }

  const shutdown = async () => {
    if ('worker' in settlement) {
      await settlement.worker.stop();
    }
    await app.close();
    await stores.pool?.end();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
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
