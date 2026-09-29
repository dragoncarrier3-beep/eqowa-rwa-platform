import type { Metadata } from 'next';

import { KycView } from '@/components/kyc-view';

export const metadata: Metadata = { title: 'Verify identity | EQOWA' };

export default function KycPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Identity verification</h1>
        <p className="max-w-2xl text-text-muted">
          Required once per investor before buying. Verification is run by Sumsub, a specialised identity verification
          provider. The platform itself stores only the result and your country.
        </p>
      </section>
      <KycView />
    </div>
  );
}
