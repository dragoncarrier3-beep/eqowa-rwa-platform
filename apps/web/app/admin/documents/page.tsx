'use client';

import { AdminDocuments } from '@/components/admin/admin-documents';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminDocumentsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
      <AdminShell>{(me) => <AdminDocuments canManage={me.permissions.includes('documents:manage')} />}</AdminShell>
    </div>
  );
}
