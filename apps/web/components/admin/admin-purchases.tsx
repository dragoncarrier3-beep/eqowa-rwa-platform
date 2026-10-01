'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { AdminQuoteDto } from '@config/api';
import { TOKEN_SYMBOL } from '@config/eqowa';

import { ConfirmationBar } from '@/components/confirmation-bar';
import { Countdown } from '@/components/countdown';
import { QuoteStatusBadge } from '@/components/status-badge';
import { TxLink } from '@/components/tx-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText } from '@/lib/admin';
import { SAFE_TX_HASH, approveSafeMint, fetchAdminQuotes } from '@/lib/admin-data';
import { APP_CHAIN_ID } from '@/lib/chain';
import { formatUnits6, shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'awaiting_safe_approval', label: 'Safe approval' },
  { value: 'quoted,deposited,awaiting_confirmations,safe_approved,minting', label: 'In progress' },
  { value: 'minted', label: 'Minted' },
  { value: 'expired,rejected', label: 'Expired or rejected' },
];

/** Records the Safe execution of a 100k approval; the settlement worker then mints. */
function SafeApproval({ quote, onDone }: { quote: AdminQuoteDto; onDone: () => void }) {
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = SAFE_TX_HASH.test(hash.trim());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await approveSafeMint(quote.intentId, hash.trim());
      onDone();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-xs text-text-muted">
        Two Safe signers must approve this mint in the Safe app first. Then paste the executed Safe transaction hash.
      </p>
      <div className="flex gap-2">
        <input
          aria-label={`Safe transaction hash for ${quote.intentId}`}
          placeholder="0x..."
          value={hash}
          onChange={(event) => setHash(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-2 py-1 font-mono text-xs text-text"
        />
        <Button type="submit" size="sm" disabled={!valid || busy}>
          Record approval
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[#ff8a8e]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function AdminPurchases({ canApprove, initialFilter = '' }: { canApprove: boolean; initialFilter?: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(initialFilter);
  const quotes = useQuery({
    queryKey: ['admin-quotes', filter],
    queryFn: () => fetchAdminQuotes(filter || undefined),
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchases</CardTitle>
        <CardDescription>Every quote, newest first. Shares mint once a deposit is 12 blocks deep.</CardDescription>
        <div role="tablist" aria-label="Filter purchases" className="flex flex-wrap gap-1 pt-2">
          {FILTERS.map((item) => (
            <button
              key={item.label}
              role="tab"
              type="button"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={cn(
                'rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text',
                filter === item.value && 'border-primary bg-primary-soft text-text',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {quotes.isPending ? (
          <p className="text-sm text-text-muted">Loading</p>
        ) : quotes.data?.state !== 'ok' ? (
          <p className="text-sm text-warning">Purchases could not be loaded.</p>
        ) : quotes.data.data.quotes.length === 0 ? (
          <p className="text-sm text-text-muted">No purchases in this view.</p>
        ) : (
          <ul className="divide-y divide-border">
            {quotes.data.data.quotes.map((quote) => (
              <li key={quote.intentId} className="grid gap-3 py-3 lg:grid-cols-[1.2fr_1fr_16rem] lg:items-start">
                <div>
                  <div className="font-mono text-sm">
                    {formatUnits6(BigInt(quote.shareAmount))} {TOKEN_SYMBOL}
                    <span className="text-text-muted"> for {formatUnits6(BigInt(quote.usdtAmount))} USDT</span>
                  </div>
                  <div className="text-xs text-text-muted">
                    Wallet <span className="font-mono">{shortAddress(quote.wallet)}</span>, reference{' '}
                    <span className="font-mono">{shortAddress(quote.intentId)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1">
                  <QuoteStatusBadge status={quote.status} />
                  {quote.mintTxHash ? (
                    <TxLink chainId={APP_CHAIN_ID} hash={quote.mintTxHash} label="Mint transaction" />
                  ) : quote.deposit ? (
                    <TxLink chainId={APP_CHAIN_ID} hash={quote.deposit.txHash} label="Deposit transaction" />
                  ) : null}
                  {quote.rejectReason ? (
                    <span className="text-xs text-text-muted">{quote.rejectReason.replaceAll('_', ' ')}</span>
                  ) : null}
                </div>
                <div>
                  {quote.status === 'quoted' ? <Countdown until={quote.quoteExpiresAt} label="Expires in" /> : null}
                  {quote.confirmations && ['deposited', 'awaiting_confirmations'].includes(quote.status) ? (
                    <ConfirmationBar current={quote.confirmations.current} required={quote.confirmations.required} />
                  ) : null}
                  {quote.status === 'awaiting_safe_approval' && canApprove ? (
                    <SafeApproval
                      quote={quote}
                      onDone={() => void queryClient.invalidateQueries({ queryKey: ['admin-quotes'] })}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
