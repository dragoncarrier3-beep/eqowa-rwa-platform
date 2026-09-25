import { createSettlementWorkerFromEnv, createStores, loadEnv } from '../bootstrap.ts';

/**
 * Settlement worker without the HTTP API. When this runs, start the API with
 * SETTLEMENT_WORKER=off so one process polls the chain, not two.
 */
async function main() {
  loadEnv();
  const stores = createStores();
  const settlement = createSettlementWorkerFromEnv(stores, { ...process.env, SETTLEMENT_WORKER: 'on' });
  if ('disabled' in settlement) {
    console.error(`Settlement worker cannot start: ${settlement.disabled}`);
    await stores.pool?.end();
    process.exitCode = 1;
    return;
  }

  settlement.worker.start();

  const shutdown = async () => {
    await settlement.worker.stop();
    await stores.pool?.end();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
