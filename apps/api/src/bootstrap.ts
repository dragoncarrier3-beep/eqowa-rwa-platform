import path from 'node:path';

import dotenv from 'dotenv';
import { JsonRpcProvider, isAddress } from 'ethers';
import pg from 'pg';

import { MemoryIdentityStore, type IdentityStore } from './kyc/identityStore.ts';
import { PgIdentityStore } from './kyc/pgIdentityStore.ts';
import { MemoryMintStore, type MintStore } from './mint/mintStore.ts';
import { PgMintStore } from './mint/pgMintStore.ts';
import type { MintExecutor } from './mint/pipeline.ts';
import { MemorySyncStateStore, PgSyncStateStore, type SyncStateStore } from './settlement/syncState.ts';
import { createSettlementWorker, type SettlementWorkerDeps } from './settlement/worker.ts';
import { createAgentSigner } from './signer/fromEnv.ts';
import { createTokenMintExecutor } from './signer/executeMint.ts';

type Env = NodeJS.ProcessEnv;

/** Repo-root .env, then apps/api/.env, then the working directory. */
export function loadEnv() {
  dotenv.config({ path: path.resolve(import.meta.dirname, '../../../.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

export function rpcProvider(env: Env = process.env) {
  const url = env.AMOY_RPC_URL;
  return url ? new JsonRpcProvider(url) : undefined;
}

export type Stores = {
  identities: IdentityStore;
  mintStore: MintStore;
  syncStore: SyncStateStore;
  pool?: pg.Pool;
};

/** Postgres when DATABASE_URL is set, memory otherwise. One pool for all stores. */
export function createStores(env: Env = process.env): Stores {
  if (!env.DATABASE_URL) {
    return {
      identities: new MemoryIdentityStore(),
      mintStore: new MemoryMintStore(),
      syncStore: new MemorySyncStateStore(),
    };
  }
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  return {
    identities: new PgIdentityStore(pool),
    mintStore: new PgMintStore(pool),
    syncStore: new PgSyncStateStore(pool),
    pool,
  };
}

/** Agent mint executor from env, or the reason it cannot be built. */
export function createMintExecutor(
  env: Env = process.env,
  provider = rpcProvider(env),
): { executor: MintExecutor } | { disabled: string } {
  const tokenAddress = env.TOKEN_ADDRESS;
  if (!tokenAddress || !provider) {
    return { disabled: 'TOKEN_ADDRESS and AMOY_RPC_URL are required' };
  }
  try {
    const signer = createAgentSigner({ env, provider });
    if (!signer) {
      return { disabled: 'set AGENT_SIGNER_PRIVATE_KEY or KMS_KEY_ARN' };
    }
    return { executor: createTokenMintExecutor({ signer, tokenAddress }) };
  } catch (error) {
    return { disabled: error instanceof Error ? error.message : String(error) };
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Builds the settlement worker from env, or says why it is off. Requires the
 * escrow, the USDT it accepts, the scan start block and a working executor.
 */
export function createSettlementWorkerFromEnv(
  stores: Stores,
  env: Env = process.env,
): { worker: ReturnType<typeof createSettlementWorker> } | { disabled: string } {
  if (env.SETTLEMENT_WORKER === 'off') {
    return { disabled: 'SETTLEMENT_WORKER=off' };
  }

  const provider = rpcProvider(env);
  const missing = ['ESCROW_ADDRESS', 'USDT_ADDRESS', 'AMOY_RPC_URL'].filter((name) => !env[name]);
  if (missing.length > 0) {
    return { disabled: `missing ${missing.join(', ')}` };
  }
  for (const name of ['ESCROW_ADDRESS', 'USDT_ADDRESS']) {
    if (!isAddress(env[name])) {
      return { disabled: `${name} is not an address` };
    }
  }

  // Scanning from genesis is slow and starting at head would miss deposits
  // made while the worker was down, so the start block must be explicit.
  const indexFromBlock = Number(env.INDEX_FROM_BLOCK);
  if (!env.INDEX_FROM_BLOCK || !Number.isInteger(indexFromBlock) || indexFromBlock <= 0) {
    return { disabled: 'set INDEX_FROM_BLOCK to the escrow deploy block' };
  }

  const mint = createMintExecutor(env, provider);
  if ('disabled' in mint) {
    return { disabled: `agent mint unavailable: ${mint.disabled}` };
  }

  const deps: SettlementWorkerDeps = {
    chain: provider!,
    escrowAddress: env.ESCROW_ADDRESS!,
    usdtAddress: env.USDT_ADDRESS!,
    indexFromBlock,
    mintStore: stores.mintStore,
    identities: stores.identities,
    syncStore: stores.syncStore,
    mint: mint.executor,
    pollMs: positiveInt(env.SETTLEMENT_POLL_MS, 15_000),
    chunkSize: positiveInt(env.SETTLEMENT_LOG_CHUNK, 2_000),
  };
  return { worker: createSettlementWorker(deps) };
}
