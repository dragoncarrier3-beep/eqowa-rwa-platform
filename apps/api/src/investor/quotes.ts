import type { InvestorQuoteDto } from '../../../../config/api.ts';
import { CONFIRMATION_BLOCKS, type MintDeposit } from '../../../../config/mint.ts';

import type { StoredMintQuote } from '../mint/mintStore.ts';

/**
 * What an investor sees of one of their quotes. Confirmations count the same
 * way as the pipeline's 12-block gate (head minus deposit block), capped at
 * the requirement so the bar never overflows.
 */
export function toInvestorQuote(
  quote: StoredMintQuote,
  deposit: MintDeposit | undefined,
  currentBlock: number | null,
): InvestorQuoteDto {
  const confirmations =
    deposit && currentBlock !== null
      ? {
          current: Math.min(Math.max(currentBlock - deposit.blockNumber, 0), CONFIRMATION_BLOCKS),
          required: CONFIRMATION_BLOCKS,
        }
      : null;

  return {
    intentId: quote.intentId,
    status: quote.status,
    usdtAmount: quote.usdtAmount.toString(),
    fundsAmount: quote.fundsAmount.toString(),
    feeAmount: quote.feeAmount.toString(),
    remainderAmount: quote.remainderAmount.toString(),
    shares: quote.shares.toString(),
    shareAmount: quote.shareAmount.toString(),
    quoteExpiresAt: quote.quoteExpiresAt.toISOString(),
    rejectReason: quote.rejectReason ?? null,
    deposit: deposit
      ? { txHash: deposit.txHash, blockNumber: deposit.blockNumber, amount: deposit.amount.toString() }
      : null,
    confirmations,
    mintTxHash: quote.mintTxHash ?? null,
  };
}
