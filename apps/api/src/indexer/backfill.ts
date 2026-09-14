import path from 'node:path';

import dotenv from 'dotenv';
import { JsonRpcProvider } from 'ethers';
import pg from 'pg';

import { TOKEN_DECIMALS, TOKEN_NAME, TOKEN_SYMBOL } from '../../../../config/eqowa.ts';

import { indexTokenLogs } from './indexLogs.ts';
import { PgEventStore } from './pgStore.ts';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

/**
 * Pull Transfer and AddressFrozen from the configured token and write them
 * to Postgres. Used against Hardhat or Amoy. Dashboard reads the tables,
 * not live RPC.
 */
async function main() {
  const rpc = process.env.AMOY_RPC_URL ?? 'http://127.0.0.1:8545';
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const databaseUrl = process.env.DATABASE_URL;

  if (!tokenAddress) {
    throw new Error('TOKEN_ADDRESS is not set');
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const fromBlock = BigInt(process.env.INDEX_FROM_BLOCK ?? '0');
  const provider = new JsonRpcProvider(rpc);
  const toBlock = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    address: tokenAddress,
    fromBlock,
    toBlock,
  });

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const store = new PgEventStore(client);
    const result = await indexTokenLogs(
      store,
      {
        tokenAddress,
        name: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        decimals: TOKEN_DECIMALS,
      },
      logs,
    );
    console.log(
      `indexed ${result.inserted} new of ${result.decoded} decoded (${result.duplicates} already stored) through block ${toBlock}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
