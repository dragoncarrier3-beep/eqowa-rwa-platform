'use client';

import { AdminExceptions } from '@/components/admin/admin-exceptions';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminExceptionsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Exceptions</h1>
      <AdminShell>{(me) => <AdminExceptions canResolve={me.permissions.includes('exceptions:resolve')} />}</AdminShell>
    </div>
  );
}
