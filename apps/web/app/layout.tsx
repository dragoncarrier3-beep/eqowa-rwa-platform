import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';
import { Badge } from '@/components/ui/badge';
import { WalletButton } from '@/components/wallet-button';

import './globals.css';

export const metadata: Metadata = {
  title: 'EQOWA',
  description: 'EQOWA Fintech tokenised shares platform.',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/kyc', label: 'Verify' },
  { href: '/buy', label: 'Buy' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/admin', label: 'Admin' },
  { href: '/design', label: 'Design' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <header className="border-b border-border bg-surface/80 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
              <Link href="/" className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold tracking-[0.2em] text-text">EQOWA</span>
                <Badge tone="live">Testnet</Badge>
              </Link>
              <div className="flex items-center gap-3">
                <nav className="flex items-center gap-1 text-sm">
                  {NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-md px-3 py-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                <WalletButton />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mt-12 border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-text-faint">
              <span>EQOWA Fintech. Software provider, not a broker-dealer or custodian.</span>
              <nav className="flex gap-4">
                <Link href="/legal/terms" className="hover:text-text-muted">
                  Terms of use
                </Link>
                <Link href="/legal/privacy" className="hover:text-text-muted">
                  Privacy
                </Link>
                <Link href="/legal/risk" className="hover:text-text-muted">
                  Risk disclaimer
                </Link>
              </nav>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
