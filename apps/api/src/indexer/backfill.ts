import path from 'node:path';

import dotenv from 'dotenv';
import { JsonRpcProvider } from 'ethers';
import pg from 'pg';

import { PgSyncStateStore } from '../settlement/syncState.ts';

import { PgTokenLedger } from './pgLedger.ts';
import { createTokenIndexer } from './tokenWorker.ts';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

/**
 * One catch-up pass of the token indexer: events and balances to Postgres,
 * up to 12 blocks behind head. Same code path as the in-process indexer, so
 * running both is safe (events are stored once).
 */
async function main() {
  const rpc = process.env.RPC_URL || process.env.AMOY_RPC_URL || 'http://127.0.0.1:8545';
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const databaseUrl = process.env.DATABASE_URL;

  if (!tokenAddress) {
    throw new Error('TOKEN_ADDRESS is not set');
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const indexer = createTokenIndexer({
      chain: new JsonRpcProvider(rpc),
      tokenAddress,
      indexFromBlock: Number(process.env.TOKEN_INDEX_FROM_BLOCK ?? '1'),
      ledger: new PgTokenLedger(pool),
      syncStore: new PgSyncStateStore(pool),
    });
    const result = await indexer.tick();
    if (result.errors > 0) {
      throw new Error('token scan failed, see the log above');
    }
    console.log(
      `applied ${result.applied} new events (${result.duplicates} already stored) through block ${result.scannedTo ?? 'none'}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
