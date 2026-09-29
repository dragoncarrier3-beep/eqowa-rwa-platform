import type { MintQuoteStatus } from './mintStatus';

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
  investorPortfolio: '/investor/portfolio',
  investorQuotes: '/investor/quotes',
  investorQuote: (intentId: string) => `/investor/quotes/${intentId}`,
  investorCheckout: '/investor/checkout',
  mintQuotes: '/mint/quotes',
  relayerApprove: '/relayer/approve',
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

/** One lock-up tranche: `amount` token base units, unlocking at `releaseAt`. */
export type LockTrancheDto = { amount: string; releaseAt: string };

/**
 * The signed-in investor's holding, read live from the chain at `blockNumber`.
 * Lock-up figures are per identity (ONCHAINID) and so cover all its wallets.
 */
export type PortfolioResponse = {
  ok: true;
  walletAddress: string;
  tokenAddress: string;
  chainId: number;
  blockNumber: number;
  readAt: string;
  /** Token base units. */
  balance: string;
  /** Whole wallet frozen by the agent. */
  frozen: boolean;
  /** Part of the balance frozen by the agent. */
  frozenTokens: string;
  /** Null when the wallet has no identity in the registry yet. */
  identityAddress: string | null;
  /** Null without an identity or when the lock-up module is not configured. */
  lockup: {
    locked: string;
    spendable: string;
    lockupDays: number;
    tranches: LockTrancheDto[];
  } | null;
};

export type InvestorQuoteDto = {
  intentId: string;
  status: MintQuoteStatus;
  /** USDT base units. */
  usdtAmount: string;
  fundsAmount: string;
  feeAmount: string;
  /** USDT the deposit carried beyond whole shares. Never minted. */
  remainderAmount: string;
  shares: string;
  /** Token base units. */
  shareAmount: string;
  quoteExpiresAt: string;
  rejectReason: string | null;
  deposit: { txHash: string; blockNumber: number; amount: string } | null;
  /** Null before a deposit, or when the chain head is unknown. */
  confirmations: { current: number; required: number } | null;
  mintTxHash: string | null;
};

export type InvestorQuotesResponse = { ok: true; currentBlock: number | null; quotes: InvestorQuoteDto[] };
export type InvestorQuoteResponse = { ok: true; currentBlock: number | null; quote: InvestorQuoteDto };

/** Why a purchase cannot go ahead yet. The page explains each one. */
export type CheckoutBlocker =
  'below_share_price' | 'kyc_not_approved' | 'identity_not_verified' | 'not_compliant' | 'insufficient_usdt';

/**
 * Everything the checkout page needs for one amount, read at `blockNumber`:
 * the split, the eligibility checks the token itself makes at mint
 * (isVerified and canTransfer from the zero address), the investor's USDT,
 * and the nonces and addresses to sign against. USDT amounts in base units.
 */
export type CheckoutResponse = {
  ok: true;
  walletAddress: string;
  chainId: number;
  blockNumber: number;
  usdtAmount: string;
  shares: string;
  shareAmount: string;
  fundsAmount: string;
  feeAmount: string;
  /** Paid beyond whole shares. Flagged for refund, never minted. */
  remainderAmount: string;
  kycStatus: KycStatus | null;
  identityVerified: boolean;
  compliant: boolean;
  usdtBalance: string;
  allowance: string;
  /** True when the escrow allowance is short and a gasless approval is needed first. */
  needsApproval: boolean;
  blockers: CheckoutBlocker[];
  contracts: { usdt: string; escrow: string; forwarder: string };
  usdtName: string;
  usdtMetaNonce: string;
  forwarderNonce: string;
};
