'use client';

import { AdminControls } from '@/components/admin/admin-controls';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminControlsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Token controls</h1>
      <AdminShell>
        {(me) =>
          me.permissions.includes('token:pause') ? (
            <AdminControls />
          ) : (
            <p className="text-sm text-text-muted">Token controls are for the Technical and Operations role.</p>
          )
        }
      </AdminShell>
    </div>
  );
}
