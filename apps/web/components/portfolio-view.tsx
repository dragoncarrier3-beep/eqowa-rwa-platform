'use client';

import { useQuery } from '@tanstack/react-query';

import type { InvestorQuoteDto, PortfolioResponse } from '@config/api';
import { TOKEN_SYMBOL } from '@config/eqowa';

import { ConfirmationBar } from '@/components/confirmation-bar';
import { Countdown } from '@/components/countdown';
import { StatTile } from '@/components/stat-tile';
import { QuoteStatusBadge } from '@/components/status-badge';
import { TxLink } from '@/components/tx-link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { APP_CHAIN_ID } from '@/lib/chain';
import { formatUnits6 } from '@/lib/format';
import { IN_PROGRESS, availableToTransfer, fetchPortfolio, fetchQuotes, unlockText } from '@/lib/portfolio';

const UNAVAILABLE_TEXT: Record<string, string> = {
  portfolio_unavailable: 'Holdings are not available on this environment yet.',
  chain_unavailable: 'The blockchain could not be read just now. Figures will return shortly.',
  api_unreachable: 'The platform is not reachable. Please try again shortly.',
};

function Holdings({ portfolio, now }: { portfolio: PortfolioResponse; now: Date }) {
  const lockup = portfolio.lockup;
  return (
    <section className="space-y-4" aria-label="Holdings">
      {portfolio.frozen ? (
        <div
          role="alert"
          className="rounded-panel border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-[#ff8a8e]"
        >
          This wallet is frozen by EQOWA compliance. Transfers are blocked until it is released. Contact support.
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Balance" value={formatUnits6(BigInt(portfolio.balance))} unit={TOKEN_SYMBOL} live />
        <StatTile
          label="Locked"
          value={lockup ? formatUnits6(BigInt(lockup.locked)) : 'n/a'}
          unit={lockup ? TOKEN_SYMBOL : undefined}
          hint={lockup ? `${lockup.lockupDays} day lock-up per purchase` : 'No lock-up recorded'}
        />
        <StatTile
          label="Available to transfer"
          value={formatUnits6(availableToTransfer(portfolio))}
          unit={TOKEN_SYMBOL}
          hint={
            BigInt(portfolio.frozenTokens) > 0n ? `${formatUnits6(BigInt(portfolio.frozenTokens))} frozen` : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unlock schedule</CardTitle>
          <CardDescription>
            Each purchase unlocks on its own date. Figures cover every wallet linked to your verified identity, read at
            block {portfolio.blockNumber.toLocaleString('en-US')}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lockup && lockup.tranches.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-text-faint">
                <tr>
                  <th className="pb-2 font-medium">Amount</th>
                  <th className="pb-2 font-medium">Unlocks on</th>
                  <th className="pb-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {lockup.tranches.map((tranche) => (
                  <tr key={`${tranche.releaseAt}-${tranche.amount}`} className="border-t border-border">
                    <td className="py-2 font-mono">
                      {formatUnits6(BigInt(tranche.amount))} {TOKEN_SYMBOL}
                    </td>
                    <td className="py-2">
                      {new Date(tranche.releaseAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                    </td>
                    <td className="py-2 text-right text-text-muted">{unlockText(tranche.releaseAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-text-muted">Nothing is locked right now.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function QuoteProgress({ quote }: { quote: InvestorQuoteDto }) {
  if (quote.status === 'quoted') {
    return <Countdown until={quote.quoteExpiresAt} label="Pay within" />;
  }
  if (quote.confirmations && ['deposited', 'awaiting_confirmations'].includes(quote.status)) {
    return <ConfirmationBar current={quote.confirmations.current} required={quote.confirmations.required} />;
  }
  if (quote.status === 'awaiting_safe_approval') {
    return <span className="text-xs text-text-muted">Large purchase, waiting for two EQOWA signers</span>;
  }
  if (quote.status === 'rejected' && quote.rejectReason) {
    return <span className="text-xs text-text-muted">{quote.rejectReason.replaceAll('_', ' ')}</span>;
  }
  return null;
}

function Quotes({ quotes }: { quotes: InvestorQuoteDto[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchases</CardTitle>
        <CardDescription>
          Shares are minted once your USDT deposit is 12 blocks deep. Anything paid beyond whole shares is flagged for a
          refund.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {quotes.length === 0 ? (
          <p className="text-sm text-text-muted">No purchases yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {quotes.map((quote) => (
              <li key={quote.intentId} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto_14rem] sm:items-center">
                <div>
                  <div className="font-mono text-sm">
                    {formatUnits6(BigInt(quote.shareAmount))} {TOKEN_SYMBOL}
                  </div>
                  <div className="text-xs text-text-muted">
                    {formatUnits6(BigInt(quote.usdtAmount))} USDT
                    {BigInt(quote.remainderAmount) > 0n
                      ? `, ${formatUnits6(BigInt(quote.remainderAmount))} USDT to refund`
                      : ''}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <QuoteStatusBadge status={quote.status} />
                  {quote.mintTxHash ? (
                    <TxLink chainId={APP_CHAIN_ID} hash={quote.mintTxHash} label="Mint transaction" />
                  ) : quote.deposit ? (
                    <TxLink chainId={APP_CHAIN_ID} hash={quote.deposit.txHash} label="Deposit transaction" />
                  ) : null}
                </div>
                <QuoteProgress quote={quote} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Investor portfolio: live holdings and lock-up from the chain, purchases from the pipeline. */
export function PortfolioView({ now = new Date() }: { now?: Date }) {
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: fetchPortfolio, refetchInterval: 30_000 });
  const quotes = useQuery({
    queryKey: ['quotes'],
    queryFn: fetchQuotes,
    // Poll while a purchase is moving, so confirmations tick up without a reload.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.state === 'ok' && data.data.quotes.some((quote) => IN_PROGRESS.includes(quote.status))
        ? 5_000
        : 30_000;
    },
  });

  if (portfolio.isPending || quotes.isPending) {
    return <p className="text-sm text-text-muted">Loading your portfolio</p>;
  }
  if (portfolio.data?.state === 'signed_out' || quotes.data?.state === 'signed_out') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to see your portfolio</CardTitle>
          <CardDescription>
            Connect your wallet with the button at the top right and sign the message. Signing is free and sends no
            transaction.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {portfolio.data?.state === 'ok' ? (
        <Holdings portfolio={portfolio.data.data} now={now} />
      ) : (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Badge tone="warning">Holdings unavailable</Badge>
          {UNAVAILABLE_TEXT[portfolio.data?.state === 'unavailable' ? portfolio.data.reason : ''] ??
            UNAVAILABLE_TEXT.api_unreachable}
        </div>
      )}
      {quotes.data?.state === 'ok' ? <Quotes quotes={quotes.data.data.quotes} /> : null}
    </div>
  );
}
