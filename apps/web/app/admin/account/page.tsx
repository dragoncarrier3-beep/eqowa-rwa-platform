'use client';

import { AdminHome } from '@/components/admin/admin-home';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminAccountPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">My keys</h1>
      <AdminShell>{() => <AdminHome />}</AdminShell>
    </div>
  );
}
