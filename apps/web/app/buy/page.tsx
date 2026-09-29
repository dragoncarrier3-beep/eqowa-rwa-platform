import type { Metadata } from 'next';

import { CheckoutView } from '@/components/checkout-view';

export const metadata: Metadata = { title: 'Buy | EQOWA' };

export default function BuyPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Buy EQOWA Group Shares</h1>
        <p className="max-w-2xl text-text-muted">
          Pay in USDT on Polygon. You sign twice at most and never pay network fees. Each purchase is locked for 730
          days from its mint.
        </p>
      </section>
      <CheckoutView />
    </div>
  );
}
