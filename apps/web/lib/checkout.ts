import type { ApiError, CheckoutBlocker, CheckoutResponse } from '@config/api';
import { approvalTypedData, depositTypedData } from '@config/checkout';

import { load } from '@/lib/portfolio';
import { proxied } from '@/lib/siwe';

export const SHARE_PRICE_USDT_UNITS = 5_000_000n;

export const fetchCheckout = (usdtAmount: bigint) =>
  load<CheckoutResponse>(`/investor/checkout?usdtAmount=${usdtAmount.toString()}`);

export type PurchaseStep = 'quote' | 'approve' | 'deposit';

export class PurchaseError extends Error {
  constructor(
    readonly step: PurchaseStep,
    readonly reason: string,
  ) {
    super(`${step}: ${reason}`);
  }
}

/** The shape wagmi's signTypedDataAsync takes; tests pass a fake. */
export type SignTypedData = (
  typed: ReturnType<typeof approvalTypedData> | ReturnType<typeof depositTypedData>,
) => Promise<`0x${string}`>;

async function post<T>(step: PurchaseStep, route: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(proxied(route), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PurchaseError(step, 'api_unreachable');
  }
  const json = (await response.json().catch(() => ({ ok: false, reason: 'api_unreachable' }))) as
    (T & { ok: true }) | ApiError;
  if (!json.ok) {
    throw new PurchaseError(step, json.reason);
  }
  return json;
}

/**
 * The whole purchase: lock a quote, approve the escrow for exactly the
 * quoted USDT if needed, then deposit. The investor signs twice at most and
 * pays no gas; the relayer submits both. The quote comes first so its
 * 15-minute window covers the signing. Returns the intent id to track.
 */
export async function runPurchase(input: {
  checkout: CheckoutResponse;
  signTypedData: SignTypedData;
  onStep?: (step: PurchaseStep) => void;
}): Promise<{ intentId: string }> {
  const { checkout } = input;
  const amount = BigInt(checkout.usdtAmount);

  input.onStep?.('quote');
  const { quote } = await post<{ quote: { intentId: string } }>('quote', '/mint/quotes', {
    wallet: checkout.walletAddress,
    usdtAmount: checkout.usdtAmount,
  });

  if (checkout.needsApproval) {
    input.onStep?.('approve');
    const approval = approvalTypedData({
      chainId: checkout.chainId,
      usdt: checkout.contracts.usdt,
      usdtName: checkout.usdtName,
      escrow: checkout.contracts.escrow,
      from: checkout.walletAddress,
      nonce: BigInt(checkout.usdtMetaNonce),
      amount,
    });
    const signature = await input.signTypedData(approval);
    await post('approve', '/relayer/approve', {
      from: checkout.walletAddress,
      functionSignature: approval.message.functionSignature,
      signature,
    });
  }

  input.onStep?.('deposit');
  const deposit = depositTypedData({
    chainId: checkout.chainId,
    forwarder: checkout.contracts.forwarder,
    escrow: checkout.contracts.escrow,
    from: checkout.walletAddress,
    nonce: BigInt(checkout.forwarderNonce),
    intentId: quote.intentId,
    amount,
  });
  const signature = await input.signTypedData(deposit);
  const { message } = deposit;
  await post('deposit', '/relayer/deposit', {
    request: {
      from: message.from,
      to: message.to,
      value: message.value.toString(),
      gas: message.gas.toString(),
      nonce: message.nonce.toString(),
      data: message.data,
    },
    signature,
  });

  return { intentId: quote.intentId };
}

export const BLOCKER_TEXT: Record<CheckoutBlocker, string> = {
  below_share_price: 'The amount is below the price of one share (5 USDT).',
  kyc_not_approved: 'Complete identity verification (KYC) on the Verify page before buying.',
  identity_not_verified: 'Your verified identity is not registered on-chain yet. This follows KYC approval.',
  not_compliant:
    'This purchase breaks a rule of the offering: country, the 150,000 share limit, the holder limit or the daily limit.',
  insufficient_usdt: 'Your wallet does not hold enough USDT for this amount.',
};

const REASON_TEXT: Record<string, string> = {
  api_unreachable: 'The platform is not reachable. Please try again shortly.',
  relayer_unavailable: 'Gasless payments are not available right now. Please try again later.',
  relay_failed: 'The network did not accept the transaction. Please try again.',
  relay_rejected: 'The payment was refused on-chain. No USDT left your wallet.',
  invalid_signature: 'The signature did not match your wallet. Please try again.',
  wrong_wallet: 'Switch your wallet back to the account you signed in with.',
  not_escrow_approval: 'The approval request was not valid.',
  domain_mismatch: 'This USDT token is not supported for gasless approval.',
  unauthenticated: 'Your session ended. Sign in again with your wallet.',
  invalid_amount: 'Enter a valid amount.',
};

export function purchaseErrorText(error: unknown): string {
  if (error instanceof PurchaseError) {
    return REASON_TEXT[error.reason] ?? 'Something went wrong. No USDT was taken unless the deposit step completed.';
  }
  if (error instanceof Error && /rejected|denied/i.test(error.message)) {
    return 'You cancelled the signature in your wallet. Nothing was sent.';
  }
  return 'Something went wrong. Please try again.';
}
