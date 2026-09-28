import { Contract, getAddress, type ContractRunner } from 'ethers';

import { BALANCE_CAP_ABI, DAILY_MINT_CAP_ABI, HOLDER_COUNT_CAP_ABI, TOKEN_VIEW_ABI } from '../../../../config/abis.ts';
import type { AssetSummaryDto } from '../../../../config/api.ts';
import { LOCKUP_DURATION_SECONDS, SHARE_PRICE_USDT } from '../../../../config/eqowa.ts';

/** A JsonRpcProvider in production, a fake in tests. */
export type ChainReader = ContractRunner & { getBlockNumber(): Promise<number> };

/** One listed token and the compliance modules that report on it. Unset modules read as null. */
export type AssetSource = {
  tokenAddress: string;
  modules: {
    holderCountCap?: string;
    balanceCap?: string;
    dailyMintCap?: string;
  };
};

const SECONDS_PER_DAY = 24n * 60n * 60n;

function moduleView(chain: ChainReader, address: string | undefined, abi: string[]) {
  return address ? new Contract(address, abi, chain) : undefined;
}

/**
 * Reads every figure at one block so supply, holders and caps are consistent
 * with each other. A failed read throws; the route answers 503.
 */
export async function readAssetSummary(input: {
  chain: ChainReader;
  chainId: number;
  source: AssetSource;
  now: Date;
}): Promise<AssetSummaryDto> {
  const { chain, source } = input;
  const blockNumber = await chain.getBlockNumber();
  const at = { blockTag: blockNumber };

  const token = new Contract(source.tokenAddress, TOKEN_VIEW_ABI, chain);
  const [name, symbol, decimals, totalSupply, paused, compliance] = await Promise.all([
    token.name(at) as Promise<string>,
    token.symbol(at) as Promise<string>,
    token.decimals(at) as Promise<bigint>,
    token.totalSupply(at) as Promise<bigint>,
    token.paused(at) as Promise<boolean>,
    token.compliance(at) as Promise<string>,
  ]);

  const holders = moduleView(chain, source.modules.holderCountCap, HOLDER_COUNT_CAP_ABI);
  const balanceCap = moduleView(chain, source.modules.balanceCap, BALANCE_CAP_ABI);
  const mintCap = moduleView(chain, source.modules.dailyMintCap, DAILY_MINT_CAP_ABI);
  const [holderCount, maxHolderCount, maxBalance, dailyMintCap, remainingMintAllowance] = await Promise.all([
    holders?.getHolderCount(compliance, at) as Promise<bigint> | undefined,
    holders?.getMaxHolderCount(compliance, at) as Promise<bigint> | undefined,
    balanceCap?.getMaxBalance(compliance, at) as Promise<bigint> | undefined,
    mintCap?.getDailyMintCap(compliance, at) as Promise<bigint> | undefined,
    mintCap?.getRemainingAllowance(compliance, at) as Promise<bigint> | undefined,
  ]);

  return {
    tokenAddress: getAddress(source.tokenAddress),
    chainId: input.chainId,
    name,
    symbol,
    decimals: Number(decimals),
    totalSupply: totalSupply.toString(),
    paused,
    holderCount: holderCount === undefined ? null : Number(holderCount),
    maxHolderCount: maxHolderCount === undefined ? null : Number(maxHolderCount),
    maxBalance: maxBalance?.toString() ?? null,
    dailyMintCap: dailyMintCap?.toString() ?? null,
    remainingMintAllowance: remainingMintAllowance?.toString() ?? null,
    // Price and lock-up are fixed by the offering (config/eqowa.ts). The live
    // per-tranche lock-up comes with the investor portfolio.
    sharePriceUsdt: SHARE_PRICE_USDT.toString(),
    lockupDays: Number(LOCKUP_DURATION_SECONDS / SECONDS_PER_DAY),
    blockNumber,
    readAt: input.now.toISOString(),
  };
}

export type AssetCatalog = {
  list(): Promise<AssetSummaryDto[]>;
  /** Null when the address is not a listed token. */
  get(tokenAddress: string): Promise<AssetSummaryDto | null>;
};

/**
 * Listed tokens with a short cache, so a busy landing page costs one round of
 * RPC reads per `ttlMs` instead of one per visitor. Concurrent misses share
 * the same read.
 */
export function createAssetCatalog(input: {
  chain: ChainReader;
  chainId: number;
  sources: AssetSource[];
  ttlMs: number;
  now?: () => Date;
}): AssetCatalog {
  const now = input.now ?? (() => new Date());
  const cache = new Map<string, { at: number; value: Promise<AssetSummaryDto> }>();
  const sources = new Map(input.sources.map((source) => [source.tokenAddress.toLowerCase(), source]));

  function read(key: string, source: AssetSource) {
    const hit = cache.get(key);
    const at = now().getTime();
    if (hit && at - hit.at < input.ttlMs) {
      return hit.value;
    }
    const value = readAssetSummary({ chain: input.chain, chainId: input.chainId, source, now: now() });
    cache.set(key, { at, value });
    // A failed read must not stick for the whole TTL.
    value.catch(() => {
      if (cache.get(key)?.value === value) {
        cache.delete(key);
      }
    });
    return value;
  }

  return {
    list: () => Promise.all([...sources].map(([key, source]) => read(key, source))),
    async get(tokenAddress) {
      const key = tokenAddress.toLowerCase();
      const source = sources.get(key);
      return source ? read(key, source) : null;
    },
  };
}
