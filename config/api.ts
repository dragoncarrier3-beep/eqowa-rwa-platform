/**
 * HTTP contract between the API and the web app: route paths and the JSON
 * shapes they return. Amounts are base-unit strings because JSON has no bigint.
 */

export const API_ROUTES = {
  health: '/health',
  assets: '/assets',
  asset: (tokenAddress: string) => `/assets/${tokenAddress}`,
  mintQuotes: '/mint/quotes',
  relayerDeposit: '/relayer/deposit',
} as const;

export type ApiError = { ok: false; reason: string; detail?: string };

/** Live figures for one token, read from the chain at `blockNumber`. */
export type AssetSummaryDto = {
  tokenAddress: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  /** Token base units. */
  totalSupply: string;
  paused: boolean;
  /** Distinct ONCHAINIDs holding the token. Null when the module is not configured. */
  holderCount: number | null;
  maxHolderCount: number | null;
  /** Per-identity cap in token base units. Null when the module is not configured. */
  maxBalance: string | null;
  /** Rolling 24-hour mint cap and what is left of it, token base units. */
  dailyMintCap: string | null;
  remainingMintAllowance: string | null;
  /** USDT base units an investor pays per whole share. */
  sharePriceUsdt: string;
  lockupDays: number;
  blockNumber: number;
  readAt: string;
};

export type AssetsResponse = { ok: true; assets: AssetSummaryDto[] };
export type AssetResponse = { ok: true; asset: AssetSummaryDto };
