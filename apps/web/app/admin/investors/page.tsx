'use client';

import { AdminInvestors } from '@/components/admin/admin-investors';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminInvestorsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Investors</h1>
      <AdminShell>{(me) => <AdminInvestors canFreeze={me.permissions.includes('investors:freeze')} />}</AdminShell>
    </div>
  );
}
