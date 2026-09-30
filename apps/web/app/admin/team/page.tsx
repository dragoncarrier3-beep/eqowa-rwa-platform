import type { Metadata } from 'next';

import { AdminTeam } from '@/components/admin/admin-team';

export const metadata: Metadata = { title: 'Team | EQOWA Admin' };

export default function AdminTeamPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
      <AdminTeam />
    </div>
  );
}
