import type { ApiError, InvestorQuotesResponse, PortfolioResponse } from '@config/api';
import type { MintQuoteStatus } from '@config/mintStatus';

import { proxied } from '@/lib/siwe';

/** A signed-out visitor is a normal state for these pages, not an error. */
export type Loaded<T> = { state: 'ok'; data: T } | { state: 'signed_out' } | { state: 'unavailable'; reason: string };

async function load<T extends { ok: true }>(route: string): Promise<Loaded<T>> {
  let response: Response;
  try {
    response = await fetch(proxied(route), { cache: 'no-store' });
  } catch {
    return { state: 'unavailable', reason: 'api_unreachable' };
  }
  if (response.status === 401) {
    return { state: 'signed_out' };
  }
  const body = (await response.json().catch(() => ({ ok: false, reason: 'api_unreachable' }))) as T | ApiError;
  return body.ok ? { state: 'ok', data: body as T } : { state: 'unavailable', reason: (body as ApiError).reason };
}

export const fetchPortfolio = () => load<PortfolioResponse>('/investor/portfolio');
export const fetchQuotes = () => load<InvestorQuotesResponse>('/investor/quotes');

/**
 * What the wallet may move right now: not frozen, not locked. The lock-up is
 * per identity, so with several wallets the identity's spendable amount can
 * be the tighter limit.
 */
export function availableToTransfer(portfolio: PortfolioResponse): bigint {
  if (portfolio.frozen) {
    return 0n;
  }
  const unfrozen = BigInt(portfolio.balance) - BigInt(portfolio.frozenTokens);
  const free = unfrozen < 0n ? 0n : unfrozen;
  if (!portfolio.lockup) {
    return free;
  }
  const spendable = BigInt(portfolio.lockup.spendable);
  return spendable < free ? spendable : free;
}

/** "in 702 days", "tomorrow", "unlocked". */
export function unlockText(releaseAt: string, now: Date): string {
  const ms = Date.parse(releaseAt) - now.getTime();
  if (ms <= 0) {
    return 'unlocked';
  }
  const days = Math.ceil(ms / 86_400_000);
  return days === 1 ? 'tomorrow' : `in ${days.toLocaleString('en-US')} days`;
}

/** "14:05" under an hour, "2h 03m" above. Zero once passed. */
export function countdownText(until: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((Date.parse(until) - now.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Quotes still moving through the pipeline, which the page keeps polling. */
export const IN_PROGRESS: readonly MintQuoteStatus[] = [
  'quoted',
  'deposited',
  'awaiting_confirmations',
  'awaiting_safe_approval',
  'safe_approved',
  'minting',
];
