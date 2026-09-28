import path from 'node:path';

import dotenv from 'dotenv';
import { JsonRpcProvider, isAddress } from 'ethers';
import pg from 'pg';

import { createAssetCatalog, type AssetCatalog } from './assets/catalog.ts';
import { MemoryTokenLedger, type TokenLedgerStore } from './indexer/ledger.ts';
import { PgTokenLedger } from './indexer/pgLedger.ts';
import { createTokenIndexer } from './indexer/tokenWorker.ts';
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
  ledger: TokenLedgerStore;
  pool?: pg.Pool;
};

/** Postgres when DATABASE_URL is set, memory otherwise. One pool for all stores. */
export function createStores(env: Env = process.env): Stores {
  if (!env.DATABASE_URL) {
    return {
      identities: new MemoryIdentityStore(),
      mintStore: new MemoryMintStore(),
      syncStore: new MemorySyncStateStore(),
      ledger: new MemoryTokenLedger(),
    };
  }
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  return {
    identities: new PgIdentityStore(pool),
    mintStore: new PgMintStore(pool),
    syncStore: new PgSyncStateStore(pool),
    ledger: new PgTokenLedger(pool),
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

/**
 * Public asset listing from env: the token plus the compliance modules that
 * report holders and caps (addresses from deployments/<network>.json).
 * A module left unset reads as null rather than failing the listing.
 */
export function createAssetCatalogFromEnv(
  env: Env = process.env,
  provider = rpcProvider(env),
): { catalog: AssetCatalog } | { disabled: string } {
  if (!env.TOKEN_ADDRESS || !provider) {
    return { disabled: 'TOKEN_ADDRESS and AMOY_RPC_URL are required' };
  }
  const moduleVars = ['HOLDER_COUNT_MODULE_ADDRESS', 'BALANCE_CAP_MODULE_ADDRESS', 'DAILY_MINT_CAP_MODULE_ADDRESS'];
  for (const name of ['TOKEN_ADDRESS', ...moduleVars]) {
    if (env[name] && !isAddress(env[name])) {
      return { disabled: `${name} is not an address` };
    }
  }

  return {
    catalog: createAssetCatalog({
      chain: provider,
      chainId: positiveInt(env.CHAIN_ID, 80002),
      sources: [
        {
          tokenAddress: env.TOKEN_ADDRESS,
          modules: {
            holderCountCap: env.HOLDER_COUNT_MODULE_ADDRESS || undefined,
            balanceCap: env.BALANCE_CAP_MODULE_ADDRESS || undefined,
            dailyMintCap: env.DAILY_MINT_CAP_MODULE_ADDRESS || undefined,
          },
        },
      ],
      ttlMs: positiveInt(env.ASSET_CACHE_MS, 15_000),
    }),
  };
}

/**
 * Token indexer from env: keeps `balances` in step with the token. Runs in the
 * API process unless TOKEN_INDEXER=off. Needs the token deploy block, for the
 * same reason the settlement worker needs the escrow deploy block.
 */
export function createTokenIndexerFromEnv(
  stores: Stores,
  env: Env = process.env,
  provider = rpcProvider(env),
): { indexer: ReturnType<typeof createTokenIndexer> } | { disabled: string } {
  if (env.TOKEN_INDEXER === 'off') {
    return { disabled: 'TOKEN_INDEXER=off' };
  }
  if (!env.TOKEN_ADDRESS || !provider) {
    return { disabled: 'TOKEN_ADDRESS and AMOY_RPC_URL are required' };
  }
  if (!isAddress(env.TOKEN_ADDRESS)) {
    return { disabled: 'TOKEN_ADDRESS is not an address' };
  }
  const indexFromBlock = Number(env.TOKEN_INDEX_FROM_BLOCK);
  if (!env.TOKEN_INDEX_FROM_BLOCK || !Number.isInteger(indexFromBlock) || indexFromBlock <= 0) {
    return { disabled: 'set TOKEN_INDEX_FROM_BLOCK to the token deploy block' };
  }

  return {
    indexer: createTokenIndexer({
      chain: provider,
      tokenAddress: env.TOKEN_ADDRESS,
      indexFromBlock,
      ledger: stores.ledger,
      syncStore: stores.syncStore,
      pollMs: positiveInt(env.TOKEN_INDEX_POLL_MS, 15_000),
      chunkSize: positiveInt(env.SETTLEMENT_LOG_CHUNK, 2_000),
    }),
  };
}
