'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { TOKEN_SYMBOL } from '@config/eqowa';

import { StatTile } from '@/components/stat-tile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchDashboard } from '@/lib/admin-data';
import { formatUnits6 } from '@/lib/format';

/** What needs attention first: approvals, exceptions and failed registrations. */
export function AdminOverview() {
  const dashboard = useQuery({ queryKey: ['admin-dashboard'], queryFn: fetchDashboard, refetchInterval: 30_000 });
  if (dashboard.isPending) {
    return <p className="text-sm text-text-muted">Loading</p>;
  }
  if (dashboard.data?.state !== 'ok') {
    return <p className="text-sm text-warning">The overview could not be loaded.</p>;
  }
  const data = dashboard.data.data;
  const inProgress =
    data.quotes.byStatus.deposited +
    data.quotes.byStatus.awaiting_confirmations +
    data.quotes.byStatus.safe_approved +
    data.quotes.byStatus.minting;

  return (
    <div className="space-y-6">
      <section aria-label="Needs attention" className="grid gap-4 sm:grid-cols-3">
        <Link href="/admin/purchases?status=awaiting_safe_approval">
          <StatTile
            label="Waiting for Safe approval"
            value={String(data.awaitingSafeApproval)}
            hint="Purchases of 100,000 USDT or more"
            live={data.awaitingSafeApproval > 0}
          />
        </Link>
        <Link href="/admin/exceptions">
          <StatTile label="Open exceptions" value={String(data.openExceptions)} hint="Refunds and payment issues" />
        </Link>
        <Link href="/admin/investors">
          <StatTile
            label="Registrations failed"
            value={String(data.kyc.registrationFailed)}
            hint="Approved by KYC, not on-chain"
          />
        </Link>
      </section>

      <section aria-label="Token" className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Shares issued"
          value={data.holders ? formatUnits6(BigInt(data.holders.totalSupply)) : 'n/a'}
          unit={data.holders ? TOKEN_SYMBOL : undefined}
          hint={
            data.holders?.indexedBlock
              ? `Indexed to block ${data.holders.indexedBlock.toLocaleString('en-US')}`
              : undefined
          }
        />
        <StatTile label="Holders" value={data.holders ? String(data.holders.holderWallets) : 'n/a'} hint="Wallets" />
        <StatTile label="Frozen wallets" value={data.holders ? String(data.holders.frozenWallets) : 'n/a'} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Purchases</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-text-muted">Total</dt>
              <dd className="text-right font-mono">{data.quotes.total}</dd>
              <dt className="text-text-muted">In progress</dt>
              <dd className="text-right font-mono">{inProgress}</dd>
              <dt className="text-text-muted">Minted</dt>
              <dd className="text-right font-mono">{data.quotes.byStatus.minted}</dd>
              <dt className="text-text-muted">Expired or rejected</dt>
              <dd className="text-right font-mono">{data.quotes.byStatus.expired + data.quotes.byStatus.rejected}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Investors</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-text-muted">KYC approved</dt>
              <dd className="text-right font-mono">{data.kyc.approved}</dd>
              <dt className="text-text-muted">Registered on-chain</dt>
              <dd className="text-right font-mono">{data.kyc.registered}</dd>
              <dt className="text-text-muted">KYC pending</dt>
              <dd className="text-right font-mono">{data.kyc.pending}</dd>
              <dt className="text-text-muted">Rejected or blocked country</dt>
              <dd className="text-right font-mono">{data.kyc.rejected + data.kyc.blockedCountry}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
