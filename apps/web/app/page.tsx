import Link from 'next/link';

import { SHARE_PRICE_USDT, TOKEN_NAME, TOKEN_SYMBOL } from '@config/eqowa';

import { StatTile } from '@/components/stat-tile';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUnits6 } from '@/lib/format';

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Badge tone="primary">Milestone 4 in progress</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{TOKEN_NAME}</h1>
        <p className="max-w-2xl text-text-muted">
          Tokenised shares issued on Polygon under ERC-3643. Every transfer is checked on-chain against the identity
          registry and the compliance rules, so the rules cannot be bypassed.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Symbol" value={TOKEN_SYMBOL} />
        <StatTile label="Share price" value={formatUnits6(SHARE_PRICE_USDT)} unit="USDT" hint="4 funds + 1 fee" />
        <StatTile label="Lock-up" value="730" unit="days" hint="Per mint, served once" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Investor portal</CardTitle>
            <CardDescription>Sign in with your wallet, complete KYC, buy shares without paying gas.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-text-muted">
            Coming in the next slices:{' '}
            <Link href="/portfolio" className="text-[#8fc1ef] hover:underline">
              portfolio
            </Link>
            , checkout, KYC and documents.
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
