import { decodeTokenLogs } from '../../../../config/tokenEvents.ts';
import type { Log } from 'ethers';

import type { AssetRecord, EventStore } from './store.ts';

export async function indexTokenLogs(
  store: EventStore,
  asset: AssetRecord,
  logs: readonly Log[],
): Promise<{ inserted: number; duplicates: number; decoded: number }> {
  await store.ensureAsset(asset);

  const events = decodeTokenLogs(logs);
  let inserted = 0;
  let duplicates = 0;

  for (const event of events) {
    const result = await store.insertTransaction({
      ...event,
      tokenAddress: asset.tokenAddress,
    });
    if (result === 'inserted') {
      inserted += 1;
    } else {
      duplicates += 1;
    }
  }

  return { inserted, duplicates, decoded: events.length };
}
