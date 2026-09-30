import path from 'node:path';

import dotenv from 'dotenv';
import { JsonRpcProvider, NonceManager, Wallet, isAddress, type Signer } from 'ethers';
import pg from 'pg';

import type { AdminAuthConfig } from './auth/adminAuth.ts';
import { MemoryAdminStore, PgAdminStore, type AdminStore } from './auth/adminStore.ts';
import { MemoryConsentStore, PgConsentStore, type ConsentStore } from './auth/consentStore.ts';
import { MemoryNonceStore, PgNonceStore, type NonceStore } from './auth/nonceStore.ts';
import type { AuthConfig } from './auth/routes.ts';
import { MIN_SECRET_LENGTH } from './auth/session.ts';
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
import { onboardInvestor } from '../../../config/onboarding.ts';

import { createOnboardingWorker } from './kyc/onboardingWorker.ts';
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
  nonces: NonceStore;
  consents: ConsentStore;
  admins: AdminStore;
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
      nonces: new MemoryNonceStore(),
      consents: new MemoryConsentStore(),
      admins: new MemoryAdminStore(),
    };
  }
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  return {
    identities: new PgIdentityStore(pool),
    mintStore: new PgMintStore(pool),
    syncStore: new PgSyncStateStore(pool),
    ledger: new PgTokenLedger(pool),
    nonces: new PgNonceStore(pool),
    consents: new PgConsentStore(pool),
    admins: new PgAdminStore(pool),
    pool,
  };
}

/**
 * The one agent signer the process uses. Minting and on-chain onboarding both
 * send from the agent key; a single NonceManager hands out nonces in order, so
 * two workers sending at the same moment cannot collide.
 */
export function createSharedAgentSigner(
  env: Env = process.env,
  provider = rpcProvider(env),
): { signer: Signer } | { disabled: string } {
  if (!provider) {
    return { disabled: 'AMOY_RPC_URL is required' };
  }
  try {
    const signer = createAgentSigner({ env, provider });
    return signer ? { signer: new NonceManager(signer) } : { disabled: 'set AGENT_SIGNER_PRIVATE_KEY or KMS_KEY_ARN' };
  } catch (error) {
    return { disabled: error instanceof Error ? error.message : String(error) };
  }
}

/** Agent mint executor from env, or the reason it cannot be built. */
export function createMintExecutor(
  env: Env = process.env,
  provider = rpcProvider(env),
  sharedSigner?: Signer,
): { executor: MintExecutor } | { disabled: string } {
  const tokenAddress = env.TOKEN_ADDRESS;
  if (!tokenAddress || !provider) {
    return { disabled: 'TOKEN_ADDRESS and AMOY_RPC_URL are required' };
  }
  try {
    const signer = sharedSigner ?? createAgentSigner({ env, provider });
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
  sharedSigner?: Signer,
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

  const mint = createMintExecutor(env, provider, sharedSigner);
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

/**
 * Investor sign-in settings, or why sign-in is off. SIWE_DOMAIN is the host
 * the web app is served on (app.eqowa.com, or localhost:3000 in dev); wallets
 * show it to the user, and a message naming any other host is refused.
 */
export function createAuthConfigFromEnv(env: Env = process.env): { auth: AuthConfig } | { disabled: string } {
  const secret = env.AUTH_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    return { disabled: `set AUTH_SECRET to at least ${MIN_SECRET_LENGTH} random characters` };
  }
  if (!env.SIWE_DOMAIN) {
    return { disabled: 'set SIWE_DOMAIN to the web app host' };
  }
  return {
    auth: {
      secret,
      cookieName: env.AUTH_COOKIE_NAME || 'eqowa_session',
      secureCookie: env.AUTH_COOKIE_SECURE !== 'false',
      siweDomain: env.SIWE_DOMAIN,
      chainId: positiveInt(env.CHAIN_ID, 80002),
    },
  };
}

/**
 * Registers KYC-approved investors on-chain. Needs the registry, the trusted
 * ClaimIssuer and the ONCHAINID implementation authority (all in
 * deployments/<network>.json), a claim signing key registered on the
 * ClaimIssuer, and the agent signer, which is also the registry agent.
 */
export function createOnboardingWorkerFromEnv(
  stores: Stores,
  env: Env = process.env,
  agent?: Signer,
): { worker: ReturnType<typeof createOnboardingWorker> } | { disabled: string } {
  if (env.ONBOARDING_WORKER === 'off') {
    return { disabled: 'ONBOARDING_WORKER=off' };
  }
  const names = ['IDENTITY_REGISTRY_ADDRESS', 'CLAIM_ISSUER_ADDRESS', 'IDENTITY_IMPLEMENTATION_AUTHORITY_ADDRESS'];
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    return { disabled: `missing ${missing.join(', ')}` };
  }
  for (const name of names) {
    if (!isAddress(env[name])) {
      return { disabled: `${name} is not an address` };
    }
  }
  if (!env.CLAIM_ISSUER_SIGNING_KEY) {
    return { disabled: 'set CLAIM_ISSUER_SIGNING_KEY to a claim signing key of the ClaimIssuer' };
  }
  if (!agent) {
    return { disabled: 'agent signer unavailable' };
  }

  let claimSigner: Wallet;
  try {
    claimSigner = new Wallet(env.CLAIM_ISSUER_SIGNING_KEY);
  } catch {
    return { disabled: 'CLAIM_ISSUER_SIGNING_KEY is not a private key' };
  }
  const contracts = {
    identityRegistry: env.IDENTITY_REGISTRY_ADDRESS!,
    claimIssuer: env.CLAIM_ISSUER_ADDRESS!,
    identityImplementationAuthority: env.IDENTITY_IMPLEMENTATION_AUTHORITY_ADDRESS!,
  };
  return {
    worker: createOnboardingWorker({
      identities: stores.identities,
      onboard: (input) => onboardInvestor({ ...input, contracts, agent, claimSigner }),
      pollMs: positiveInt(env.ONBOARDING_POLL_MS, 15_000),
    }),
  };
}

/**
 * Admin WebAuthn settings, or why admin sign-in is off. The relying party is
 * the host the web app is served on: keys enrolled on localhost do not work on
 * app.eqowa.com, so real YubiKeys are enrolled on the live host.
 */
export function createAdminAuthConfigFromEnv(
  env: Env = process.env,
): { adminAuth: AdminAuthConfig } | { disabled: string } {
  const secret = env.AUTH_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    return { disabled: `set AUTH_SECRET to at least ${MIN_SECRET_LENGTH} random characters` };
  }
  if (!env.WEBAUTHN_RP_ID || !env.WEBAUTHN_ORIGIN) {
    return { disabled: 'set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN to the web app host and origin' };
  }
  return {
    adminAuth: {
      secret,
      cookieName: env.ADMIN_COOKIE_NAME || 'eqowa_admin',
      secureCookie: env.AUTH_COOKIE_SECURE !== 'false',
      rpID: env.WEBAUTHN_RP_ID,
      rpName: env.WEBAUTHN_RP_NAME || 'EQOWA Admin',
      origin: env.WEBAUTHN_ORIGIN,
    },
  };
}
