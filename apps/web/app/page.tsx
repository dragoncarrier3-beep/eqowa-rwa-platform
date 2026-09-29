import Link from 'next/link';

import { LOCKUP_DURATION_SECONDS, MAX_HOLDER_COUNT, SHARE_PRICE_USDT, TOKEN_NAME, TOKEN_SYMBOL } from '@config/eqowa';
import { RISK_NOTICE } from '@config/terms';

import { StatTile } from '@/components/stat-tile';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchAssets } from '@/lib/api';
import { formatUnits6 } from '@/lib/format';

// Next reads this at build time and needs a literal. Keep in step with LIVE_REVALIDATE_SECONDS.
export const revalidate = 15;

const LOCKUP_DAYS = Number(LOCKUP_DURATION_SECONDS / 86_400n);

export default async function HomePage() {
  const assets = await fetchAssets();
  const asset = assets?.find((item) => item.symbol === TOKEN_SYMBOL) ?? null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Badge tone="primary">Milestone 4 in progress</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{asset?.name ?? TOKEN_NAME}</h1>
        <p className="max-w-2xl text-text-muted">
          Tokenised shares issued on Polygon under ERC-3643. Every transfer is checked on-chain against the identity
          registry and the compliance rules, so the rules cannot be bypassed.
        </p>
      </section>

      <aside
        aria-label="Risk notice"
        className="rounded-panel border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        <strong className="font-semibold">Risk notice.</strong> {RISK_NOTICE}{' '}
        <Link href="/legal/risk" className="underline">
          Read the risk disclaimer
        </Link>
        .
      </aside>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Symbol" value={TOKEN_SYMBOL} />
        <StatTile
          label="Share price"
          value={formatUnits6(asset ? BigInt(asset.sharePriceUsdt) : SHARE_PRICE_USDT)}
          unit="USDT"
          hint="4 funds + 1 fee"
        />
        <StatTile
          label="Lock-up"
          value={String(asset?.lockupDays ?? LOCKUP_DAYS)}
          unit="days"
          hint="Per mint tranche"
        />
      </div>

      <section className="space-y-3" aria-label="Live token figures">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-faint">On-chain</h2>
          {asset ? (
            <Badge tone="live">Live, block {asset.blockNumber.toLocaleString('en-US')}</Badge>
          ) : (
            <Badge tone="neutral">Chain data unavailable</Badge>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Shares issued"
            value={asset ? formatUnits6(BigInt(asset.totalSupply)) : 'n/a'}
            unit={asset ? TOKEN_SYMBOL : undefined}
            live={Boolean(asset)}
          />
          <StatTile
            label="Holders"
            value={asset?.holderCount != null ? asset.holderCount.toLocaleString('en-US') : 'n/a'}
            hint={`Verified identities, cap ${(asset?.maxHolderCount ?? Number(MAX_HOLDER_COUNT)).toLocaleString('en-US')}`}
            live={asset?.holderCount != null}
          />
          <StatTile
            label="Trading status"
            value={asset ? (asset.paused ? 'Paused' : 'Active') : 'n/a'}
            live={Boolean(asset) && !asset?.paused}
          />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Investor portal</CardTitle>
            <CardDescription>Sign in with your wallet, complete KYC, buy shares without paying gas.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-text-muted">
            <Link href="/buy" className="text-[#8fc1ef] hover:underline">
              Buy shares
            </Link>{' '}
            or open your{' '}
            <Link href="/portfolio" className="text-[#8fc1ef] hover:underline">
              portfolio
            </Link>
            . KYC and documents follow in the next slices.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Admin dashboard</CardTitle>
            <CardDescription>YubiKey login, exception queue, approvals, audit log, token controls.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-text-muted">
            Coming in the next slices:{' '}
            <Link href="/admin" className="text-[#8fc1ef] hover:underline">
              admin
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
