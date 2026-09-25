import { getAddress, isAddress } from 'ethers';

import type { MintExecutor, MintReceiptStatus } from '../../../../config/agentMint.ts';
import { buildQuote, evaluateMint, type MintDeposit, type MintQuoteStatus } from '../../../../config/mint.ts';

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
    mintTxHash: quote.mintTxHash,
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

export type { MintExecutor, MintReceiptStatus };

/** Statuses from which an intent may be claimed for minting. */
const CLAIMABLE: MintQuoteStatus[] = ['deposited', 'awaiting_confirmations'];

async function hasOpenException(store: MintStore, intentId: string, kind: string) {
  const open = await store.listExceptions({ intentId, status: 'open' });
  return open.some((row) => row.kind === kind);
}

/** Opens `kind` unless an open one already exists for the intent. */
async function openOnce(store: MintStore, intentId: string, kind: string, details: Record<string, unknown>) {
  if (await hasOpenException(store, intentId, kind)) {
    return;
  }
  await store.addException({ kind, intentId, details });
}

function mintedDecision(quote: StoredMintQuote, alreadyMinted: boolean) {
  return {
    action: 'mint' as const,
    alreadyMinted,
    shares: quote.shares.toString(),
    shareAmount: quote.shareAmount.toString(),
    fundsAmount: quote.fundsAmount.toString(),
    feeAmount: quote.feeAmount.toString(),
    remainderAmount: quote.remainderAmount.toString(),
    txHash: quote.mintTxHash,
  };
}

export async function settleMintQuote(params: {
  intentId: string;
  store: MintStore;
  identities: IdentityStore;
  now: Date;
  currentBlock: number;
  mint?: MintExecutor;
}) {
  const quote = await params.store.getQuote(params.intentId);
  if (!quote) {
    return { error: 'unknown_intent' as const };
  }
  if (quote.status === 'minted') {
    return { quote: serializeQuote(quote), decision: mintedDecision(quote, true) };
  }
  if (quote.status === 'minting') {
    if (!params.mint) {
      return { error: 'mint_unavailable' as const, quote: serializeQuote(quote) };
    }
    return confirmMintQuote({ intentId: params.intentId, store: params.store, waitFor: params.mint.wait });
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

  // Never record a mint that did not happen. Without an executor the intent
  // stays where it is and the caller is told why.
  if (!params.mint) {
    return { error: 'mint_unavailable' as const, quote: serializeQuote(quote) };
  }

  // A failed mint pauses the intent until ops resolve the exception, so a
  // reverting mint is not re-sent on every retry.
  if (await hasOpenException(params.store, params.intentId, 'mint_failed')) {
    return { error: 'mint_paused' as const, quote: serializeQuote(quote) };
  }

  const previousStatus = (await params.store.getQuote(params.intentId))?.status ?? quote.status;
  const claimed = await params.store.transitionQuoteStatus(params.intentId, CLAIMABLE, 'minting');
  if (!claimed) {
    return { error: 'not_claimable' as const, quote: serializeQuote(quote) };
  }

  let txHash: string;
  try {
    txHash = await params.mint.send({
      to: quote.wallet,
      shareAmount: decision.shareAmount,
      intentId: params.intentId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'mint failed';
    await params.store.transitionQuoteStatus(params.intentId, ['minting'], previousStatus);
    await openOnce(params.store, params.intentId, 'mint_failed', { reason });
    return { error: 'mint_failed' as const, quote: serializeQuote({ ...quote, status: previousStatus }), reason };
  }

  await params.store.setMintTxHash(params.intentId, txHash);
  await params.store.appendAudit({
    actor: 'api',
    action: 'mint.sent',
    payload: { intentId: params.intentId, txHash, shareAmount: decision.shareAmount.toString() },
  });

  return confirmMintQuote({ intentId: params.intentId, store: params.store, waitFor: params.mint.wait });
}

/**
 * Settles an intent that is in `minting`, from its stored transaction hash.
 *
 * `waitFor` may block (the executor's `wait`) or only look the receipt up
 * (a worker polling `getTransactionReceipt`). A `minting` intent with no hash
 * means the process stopped between claiming and storing the hash. No
 * automated retry is safe there, because the mint may still be in the
 * mempool, so it goes to ops as `mint_unconfirmed`.
 */
export async function confirmMintQuote(params: {
  intentId: string;
  store: MintStore;
  waitFor: (txHash: string) => Promise<MintReceiptStatus>;
}) {
  const quote = await params.store.getQuote(params.intentId);
  if (!quote) {
    return { error: 'unknown_intent' as const };
  }
  if (quote.status === 'minted') {
    return { quote: serializeQuote(quote), decision: mintedDecision(quote, true) };
  }
  if (quote.status !== 'minting') {
    return { error: 'not_minting' as const, quote: serializeQuote(quote) };
  }
  if (!quote.mintTxHash) {
    await openOnce(params.store, params.intentId, 'mint_unconfirmed', {
      wallet: quote.wallet,
      shareAmount: quote.shareAmount.toString(),
    });
    return { error: 'mint_unconfirmed' as const, quote: serializeQuote(quote) };
  }

  let status: MintReceiptStatus;
  try {
    status = await params.waitFor(quote.mintTxHash);
  } catch {
    status = 'pending';
  }

  if (status === 'pending') {
    return { error: 'mint_pending' as const, quote: serializeQuote(quote) };
  }

  if (status === 'reverted') {
    await params.store.transitionQuoteStatus(params.intentId, ['minting'], 'deposited');
    await openOnce(params.store, params.intentId, 'mint_failed', { txHash: quote.mintTxHash, reason: 'reverted' });
    return {
      error: 'mint_failed' as const,
      quote: serializeQuote({ ...quote, status: 'deposited' }),
      reason: 'reverted',
    };
  }

  await params.store.transitionQuoteStatus(params.intentId, ['minting'], 'minted');
  await params.store.appendAudit({
    actor: 'api',
    action: 'mint.confirmed',
    payload: { intentId: params.intentId, txHash: quote.mintTxHash },
  });
  if (quote.remainderAmount > 0n) {
    await params.store.addException({
      kind: 'remainder',
      intentId: params.intentId,
      details: { remainderAmount: quote.remainderAmount.toString() },
    });
  }

  const minted = { ...quote, status: 'minted' as const };
  return { quote: serializeQuote(minted), decision: mintedDecision(minted, false) };
}

export { serializeQuote };
