import { keccak256, randomBytes } from 'ethers';

import { ONE_USDT, SHARE_PRICE_USDT, shareBaseUnits, splitUsdtDeposit } from './eqowa';
import type { MintQuoteStatus } from './mintStatus';

/** A quoted intent dies if no matching deposit arrives within this window. */
export const QUOTE_TTL_SECONDS = 15 * 60;

/** Deposit must be this many blocks deep before the pipeline may mint. */
export const CONFIRMATION_BLOCKS = 12;

/**
 * Mints paid with this much USDT or more wait for sign-off by the 2-of-3 Safe
 * owners. Below it minting is automatic. Client rule of 23 August 2026:
 * "mints under $100k can be fully automated; any mint above that threshold
 * requires dual-admin Gnosis Safe sign-off".
 */
export const SAFE_APPROVAL_THRESHOLD_USDT = 100_000n * ONE_USDT;

export function requiresSafeApproval(depositAmount: bigint): boolean {
  return depositAmount >= SAFE_APPROVAL_THRESHOLD_USDT;
}

export type { MintQuoteStatus } from './mintStatus';

export type MintRejectReason =
  'quote_expired' | 'amount_mismatch' | 'kyc_not_approved' | 'below_share_price' | 'invalid_amount' | 'invalid_wallet';

export type MintQuote = {
  intentId: string;
  wallet: string;
  usdtAmount: bigint;
  shares: bigint;
  shareAmount: bigint;
  fundsAmount: bigint;
  feeAmount: bigint;
  remainderAmount: bigint;
  quoteExpiresAt: Date;
  status: MintQuoteStatus;
};

export type MintDeposit = {
  intentId: string;
  payerAddress: string;
  tokenAddress: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
  recordedAt: Date;
};

export type MintWaitDecision = {
  action: 'wait';
  reason: 'awaiting_deposit' | 'awaiting_confirmations' | 'awaiting_safe_approval';
  confirmations?: number;
};

export type MintExpireDecision = {
  action: 'expire';
  reason: 'quote_expired';
};

export type MintRejectDecision = {
  action: 'reject';
  reason: MintRejectReason;
};

export type MintIssueDecision = {
  action: 'mint';
  shares: bigint;
  shareAmount: bigint;
  fundsAmount: bigint;
  feeAmount: bigint;
  remainderAmount: bigint;
};

export type MintDecision = MintWaitDecision | MintExpireDecision | MintRejectDecision | MintIssueDecision;

/** Escrow-compatible bytes32 intent id. */
export function newIntentId(): string {
  return keccak256(randomBytes(32));
}

export function quoteExpiresAt(now: Date, ttlSeconds: number = QUOTE_TTL_SECONDS): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

/**
 * Lock a USDT amount into a 15-minute quote at 5 USDT per share.
 * Amounts below one share are rejected so the investor does not pay into a
 * zero-mint intent.
 */
export function buildQuote(params: {
  wallet: string;
  usdtAmount: bigint;
  now: Date;
  intentId?: string;
}): { quote: MintQuote } | { error: MintRejectReason } {
  if (params.usdtAmount <= 0n) {
    return { error: 'invalid_amount' };
  }

  const split = splitUsdtDeposit(params.usdtAmount);
  if (split.shares === 0n) {
    return { error: 'below_share_price' };
  }

  return {
    quote: {
      intentId: params.intentId ?? newIntentId(),
      wallet: params.wallet,
      usdtAmount: params.usdtAmount,
      shares: split.shares,
      shareAmount: shareBaseUnits(split.shares),
      fundsAmount: split.funds,
      feeAmount: split.fee,
      remainderAmount: split.remainder,
      quoteExpiresAt: quoteExpiresAt(params.now),
      status: 'quoted',
    },
  };
}

/**
 * Decide whether a quoted intent may mint.
 *
 * A deposit must arrive before the quote expires. The 12-block wait may
 * finish after expiry. Remainder USDT never mints; the caller records it
 * as an exception and still issues the whole shares.
 */
export function evaluateMint(params: {
  quote: MintQuote;
  deposit?: MintDeposit;
  kycApproved: boolean;
  now: Date;
  currentBlock: number;
}): MintDecision {
  if (params.quote.usdtAmount < SHARE_PRICE_USDT) {
    return { action: 'reject', reason: 'below_share_price' };
  }

  if (!params.deposit) {
    if (params.now.getTime() > params.quote.quoteExpiresAt.getTime()) {
      return { action: 'expire', reason: 'quote_expired' };
    }
    return { action: 'wait', reason: 'awaiting_deposit' };
  }

  if (params.deposit.recordedAt.getTime() > params.quote.quoteExpiresAt.getTime()) {
    return { action: 'reject', reason: 'quote_expired' };
  }

  if (params.deposit.amount !== params.quote.usdtAmount) {
    return { action: 'reject', reason: 'amount_mismatch' };
  }

  const confirmations = params.currentBlock - params.deposit.blockNumber;
  if (params.currentBlock < params.deposit.blockNumber + CONFIRMATION_BLOCKS) {
    return {
      action: 'wait',
      reason: 'awaiting_confirmations',
      confirmations: confirmations < 0 ? 0 : confirmations,
    };
  }

  if (!params.kycApproved) {
    return { action: 'reject', reason: 'kyc_not_approved' };
  }

  const split = splitUsdtDeposit(params.deposit.amount);
  if (split.shares === 0n) {
    return { action: 'reject', reason: 'below_share_price' };
  }

  return {
    action: 'mint',
    shares: split.shares,
    shareAmount: shareBaseUnits(split.shares),
    fundsAmount: split.funds,
    feeAmount: split.fee,
    remainderAmount: split.remainder,
  };
}
