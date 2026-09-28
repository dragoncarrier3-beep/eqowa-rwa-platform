import type { Metadata } from 'next';

import { PortfolioView } from '@/components/portfolio-view';

export const metadata: Metadata = { title: 'Portfolio | EQOWA' };

export default function PortfolioPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
        <p className="max-w-2xl text-text-muted">
          Your EQOWA Group Shares, what is locked and until when, and the status of every purchase.
        </p>
      </section>
      <PortfolioView />
    </div>
  );
}
