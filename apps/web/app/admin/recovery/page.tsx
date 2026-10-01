'use client';

import { AdminRecovery } from '@/components/admin/admin-recovery';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminRecoveryPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Key recovery</h1>
      <AdminShell>
        {(me) => <AdminRecovery canApprove={me.permissions.includes('recovery:approve')} myAdminId={me.admin.id} />}
      </AdminShell>
    </div>
  );
}
