import Image from 'next/image';

import { SHARE_PRICE_USDT, TOKEN_NAME, TOKEN_SYMBOL } from '@config/eqowa';
import type { MintQuoteStatus } from '@config/mint';

import { LegalDraftBanner } from '@/components/legal-draft-banner';
import { StatTile } from '@/components/stat-tile';
import { KycStatusBadge, QuoteStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUnits6 } from '@/lib/format';

/**
 * Colour and component preview for client sign-off. Everything on this page is
 * static; it exists so the palette is approved before the portals are built.
 */

const PALETTE: Array<{ name: string; token: string; hex: string; usage: string; className: string }> = [
  { name: 'Background', token: 'background', hex: '#070B14', usage: 'Page', className: 'bg-background' },
  { name: 'Surface', token: 'surface', hex: '#0E1626', usage: 'Cards, header', className: 'bg-surface' },
  { name: 'Surface 2', token: 'surface-2', hex: '#14203A', usage: 'Tiles, inputs', className: 'bg-surface-2' },
  { name: 'Navy', token: 'surface-3', hex: '#1C2B45', usage: 'From the logo text', className: 'bg-surface-3' },
  {
    name: 'EQOWA blue',
    token: 'primary',
    hex: '#1F6FB8',
    usage: 'Buttons, links, from the logo',
    className: 'bg-primary',
  },
  { name: 'Live cyan', token: 'live', hex: '#35C8F0', usage: 'Live chain data only', className: 'bg-live' },
  { name: 'Success', token: 'success', hex: '#2FBF71', usage: 'Minted, approved', className: 'bg-success' },
  { name: 'Amber', token: 'warning', hex: '#F2A93B', usage: 'Holds, warnings', className: 'bg-warning' },
  { name: 'Red', token: 'danger', hex: '#E5484D', usage: 'Blocked, rejected', className: 'bg-danger' },
];

const QUOTE_STATUSES: MintQuoteStatus[] = [
  'quoted',
  'deposited',
  'awaiting_confirmations',
  'awaiting_safe_approval',
  'safe_approved',
  'minting',
  'minted',
  'expired',
  'rejected',
];

export default function DesignPage() {
  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <Badge tone="live">Design preview</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">EQOWA interface colours</h1>
        <p className="max-w-2xl text-text-muted">
          Dark mission-control style. The blue and navy come from the EQOWA logo. Cyan is used only for values read live
          from the blockchain, amber for anything on hold, red for anything blocked.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Palette</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {PALETTE.map((swatch) => (
            <div
              key={swatch.token}
              className="flex items-center gap-3 rounded-panel border border-border bg-surface p-3"
            >
              <div className={`h-12 w-12 shrink-0 rounded-md border border-white/10 ${swatch.className}`} />
              <div className="min-w-0">
                <div className="text-sm font-medium">{swatch.name}</div>
                <div className="font-mono text-xs text-text-muted">{swatch.hex}</div>
                <div className="text-xs text-text-faint">{swatch.usage}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Logo</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-panel border border-border bg-[#f4f4f1] p-8">
            <Image src="/brand/eqowa-logo.png" alt="EQOWA logo" width={360} height={196} priority />
            <div className="mt-2 text-xs text-[#5f7398]">Original, on a light plate</div>
          </div>
          <div className="flex flex-col justify-between rounded-panel border border-border bg-surface p-8">
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xl font-semibold tracking-[0.25em] text-text">EQOWA</span>
              <Badge tone="live">Testnet</Badge>
            </div>
            <div className="mt-4 text-xs text-text-muted">
              Wordmark treatment on dark. A white version of the full logo is needed for dark screens; the navy text in
              the original disappears on this background.
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Sample screen: asset card</h2>
        <Card className="max-w-3xl">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>{TOKEN_NAME}</CardTitle>
              <CardDescription>
                {TOKEN_SYMBOL} on Polygon. ERC-3643, 6 decimals. Ownership held by the 2-of-3 Safe.
              </CardDescription>
            </div>
            <QuoteStatusBadge status="awaiting_safe_approval" />
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <StatTile label="Total supply" value="20,003" unit={TOKEN_SYMBOL} live />
            <StatTile label="Holders" value="1" unit="of 500" live />
            <StatTile label="Share price" value={formatUnits6(SHARE_PRICE_USDT)} unit="USDT" />
            <StatTile label="Lock-up" value="730" unit="days" />
          </CardContent>
          <CardContent className="border-t border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="text-text-muted">
                Quote expires in <span className="font-mono text-text">12:41</span>
              </div>
              <div className="flex items-center gap-2 text-text-muted">
                Confirmations
                <span className="font-mono text-live live-glow">7</span>
                <span className="text-text-faint">/ 12</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full w-7/12 bg-live" />
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button>Buy shares</Button>
            <Button variant="secondary">View documents</Button>
            <Button variant="ghost">Explorer</Button>
          </CardFooter>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Statuses</h2>
        <div className="flex flex-wrap gap-2">
          {QUOTE_STATUSES.map((status) => (
            <QuoteStatusBadge key={status} status={status} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <KycStatusBadge status="pending" />
          <KycStatusBadge status="approved" />
          <KycStatusBadge status="rejected" />
          <KycStatusBadge status="blocked_country" />
          <Badge tone="danger">Wallet frozen</Badge>
          <Badge tone="warning">Token paused</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Buttons and notices</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Freeze wallet</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="max-w-3xl">
          <LegalDraftBanner />
        </div>
      </section>
    </div>
  );
}
