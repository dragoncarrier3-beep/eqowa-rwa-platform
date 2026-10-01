'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { AdminPurchases } from '@/components/admin/admin-purchases';
import { AdminShell } from '@/components/admin/admin-shell';

function Purchases() {
  const status = useSearchParams().get('status') ?? '';
  return (
    <AdminShell>
      {(me) => <AdminPurchases canApprove={me.permissions.includes('mint:approve')} initialFilter={status} />}
    </AdminShell>
  );
}

export default function AdminPurchasesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Purchases</h1>
      <Suspense fallback={<p className="text-sm text-text-muted">Loading</p>}>
        <Purchases />
      </Suspense>
    </div>
  );
}
