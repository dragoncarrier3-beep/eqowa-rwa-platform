/**
 * HTTP contract between the API and the web app: route paths and the JSON
 * shapes they return. Amounts are base-unit strings because JSON has no bigint.
 */

export const API_ROUTES = {
  health: '/health',
  assets: '/assets',
  asset: (tokenAddress: string) => `/assets/${tokenAddress}`,
  adminHolders: '/admin/holders',
  siweNonce: '/auth/siwe/nonce',
  siweVerify: '/auth/siwe/verify',
  authMe: '/auth/me',
  logout: '/auth/logout',
  investorMe: '/investor/me',
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

/** One wallet in the indexed ledger. Balance in token base units. */
export type HolderDto = {
  walletAddress: string;
  balance: string;
  frozen: boolean;
  updatedBlock: number;
};

/**
 * Indexed holders, admin only. `indexedBlock` is the last block the token
 * indexer has fully applied (it runs 12 blocks behind head); null before the
 * first scan.
 */
export type HoldersResponse = {
  ok: true;
  tokenAddress: string;
  indexedBlock: number | null;
  stats: { holderWallets: number; frozenWallets: number; totalSupply: string };
  holders: HolderDto[];
};

export type NonceResponse = { ok: true; nonce: string; expiresAt: string };

export type SessionDto = { kind: 'investor'; walletAddress: string; expiresAt: string };
export type SessionResponse = { ok: true; session: SessionDto };

export type KycStatus = 'pending' | 'approved' | 'rejected' | 'blocked_country';

/** What the signed-in investor may see about themselves. */
export type InvestorMeResponse = {
  ok: true;
  walletAddress: string;
  /** Null until Sumsub has sent a result for this wallet. */
  kyc: { status: KycStatus; countryCode: number | null; onchainIdAddress: string } | null;
  /** Null until the token indexer has seen this wallet. Balance in token base units. */
  holding: { balance: string; frozen: boolean; updatedBlock: number } | null;
};
