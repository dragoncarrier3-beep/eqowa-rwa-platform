'use client';

import { AdminShell } from '@/components/admin/admin-shell';
import { AdminTeam } from '@/components/admin/admin-team';

export default function AdminTeamPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
      <AdminShell>{() => <AdminTeam />}</AdminShell>
    </div>
  );
}
