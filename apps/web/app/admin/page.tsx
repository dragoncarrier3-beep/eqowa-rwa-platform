'use client';

import { AdminOverview } from '@/components/admin/admin-overview';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
      <AdminShell>{() => <AdminOverview />}</AdminShell>
    </div>
  );
}
