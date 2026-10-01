'use client';

import { AdminCompliance } from '@/components/admin/admin-compliance';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminCompliancePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Compliance rules</h1>
      <AdminShell>{(me) => <AdminCompliance canPrepare={me.permissions.includes('compliance:prepare')} />}</AdminShell>
    </div>
  );
}
