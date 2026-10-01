'use client';

import { AdminAudit } from '@/components/admin/admin-audit';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminAuditPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Audit log</h1>
      <AdminShell>{() => <AdminAudit />}</AdminShell>
    </div>
  );
}
