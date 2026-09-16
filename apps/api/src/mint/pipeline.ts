import { getAddress, isAddress } from 'ethers';

import { buildQuote, evaluateMint, type MintDeposit } from '../../../../config/mint.ts';

import type { IdentityStore } from '../kyc/identityStore.ts';

import type { MintStore, StoredMintQuote } from './mintStore.ts';

export type QuoteInput = {
  wallet: string;
  usdtAmount: string;
};

export type DepositInput = {
  intentId: string;
  payerAddress: string;
  tokenAddress: string;
  amount: string;
  txHash: string;
  blockNumber: number;
};

function parseAmount(value: string): bigint | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return BigInt(value);
}

function serializeQuote(quote: StoredMintQuote) {
  return {
    intentId: quote.intentId,
    wallet: quote.wallet,
    usdtAmount: quote.usdtAmount.toString(),
    shares: quote.shares.toString(),
    shareAmount: quote.shareAmount.toString(),
    fundsAmount: quote.fundsAmount.toString(),
    feeAmount: quote.feeAmount.toString(),
    remainderAmount: quote.remainderAmount.toString(),
    quoteExpiresAt: quote.quoteExpiresAt.toISOString(),
    status: quote.status,
    rejectReason: quote.rejectReason,
  };
}

export async function createMintQuote(params: { input: QuoteInput; store: MintStore; now: Date }) {
  if (!isAddress(params.input.wallet)) {
    return { error: 'invalid_wallet' as const };
  }

  const usdtAmount = parseAmount(params.input.usdtAmount);
  if (usdtAmount === null) {
    return { error: 'invalid_amount' as const };
  }

  const built = buildQuote({
    wallet: getAddress(params.input.wallet),
    usdtAmount,
    now: params.now,
  });
  if ('error' in built) {
    return { error: built.error };
  }

  const saved = await params.store.saveQuote(built.quote);
  return { quote: serializeQuote(saved) };
}

export async function recordMintDeposit(params: { input: DepositInput; store: MintStore; now: Date }) {
  const quote = await params.store.getQuote(params.input.intentId);
  if (!quote) {
    return { error: 'unknown_intent' as const };
  }
  if (!isAddress(params.input.payerAddress) || !isAddress(params.input.tokenAddress)) {
    return { error: 'invalid_wallet' as const };
  }

  const amount = parseAmount(params.input.amount);
  if (amount === null || !Number.isInteger(params.input.blockNumber) || params.input.blockNumber < 0) {
    return { error: 'invalid_amount' as const };
  }

  const deposit: MintDeposit = {
    intentId: params.input.intentId,
    payerAddress: getAddress(params.input.payerAddress),
    tokenAddress: getAddress(params.input.tokenAddress),
    amount,
    txHash: params.input.txHash,
    blockNumber: params.input.blockNumber,
    recordedAt: params.now,
  };

  const saved = await params.store.saveDeposit(deposit);
  if (saved === 'duplicate') {
    const existing = await params.store.getDeposit(params.input.intentId);
    return { deposit: existing, duplicate: true as const };
  }

  await params.store.setQuoteStatus(params.input.intentId, 'deposited');
  return { deposit: saved, duplicate: false as const };
}

export async function settleMintQuote(params: {
  intentId: string;
  store: MintStore;
  identities: IdentityStore;
  now: Date;
  currentBlock: number;
}) {
  const quote = await params.store.getQuote(params.intentId);
  if (!quote) {
    return { error: 'unknown_intent' as const };
  }
  if (quote.status === 'minted') {
    return { quote: serializeQuote(quote), decision: { action: 'mint' as const, alreadyMinted: true } };
  }

  const deposit = await params.store.getDeposit(params.intentId);
  const identity = await params.identities.getByWallet(quote.wallet);
  const decision = evaluateMint({
    quote,
    deposit,
    kycApproved: identity?.kycStatus === 'approved',
    now: params.now,
    currentBlock: params.currentBlock,
  });

  if (decision.action === 'wait') {
    if (decision.reason === 'awaiting_confirmations') {
      await params.store.setQuoteStatus(params.intentId, 'awaiting_confirmations');
    }
    return {
      quote: serializeQuote({
        ...quote,
        status: decision.reason === 'awaiting_confirmations' ? 'awaiting_confirmations' : quote.status,
      }),
      decision,
    };
  }

  if (decision.action === 'expire') {
    await params.store.setQuoteStatus(params.intentId, 'expired', decision.reason);
    await params.store.addException({
      kind: decision.reason,
      intentId: params.intentId,
      details: { quoteExpiresAt: quote.quoteExpiresAt.toISOString() },
    });
    return { quote: serializeQuote({ ...quote, status: 'expired', rejectReason: decision.reason }), decision };
  }

  if (decision.action === 'reject') {
    await params.store.setQuoteStatus(params.intentId, 'rejected', decision.reason);
    await params.store.addException({
      kind: decision.reason,
      intentId: params.intentId,
      details: {
        quotedAmount: quote.usdtAmount.toString(),
        depositedAmount: deposit?.amount.toString() ?? null,
      },
    });
    return { quote: serializeQuote({ ...quote, status: 'rejected', rejectReason: decision.reason }), decision };
  }

  await params.store.setQuoteStatus(params.intentId, 'minted');
  if (decision.remainderAmount > 0n) {
    await params.store.addException({
      kind: 'remainder',
      intentId: params.intentId,
      details: { remainderAmount: decision.remainderAmount.toString() },
    });
  }

  return {
    quote: serializeQuote({ ...quote, status: 'minted' }),
    decision: {
      action: 'mint' as const,
      alreadyMinted: false,
      shares: decision.shares.toString(),
      shareAmount: decision.shareAmount.toString(),
      fundsAmount: decision.fundsAmount.toString(),
      feeAmount: decision.feeAmount.toString(),
      remainderAmount: decision.remainderAmount.toString(),
    },
  };
}

export { serializeQuote };
