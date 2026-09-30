import type { Metadata } from 'next';

import { AdminHome } from '@/components/admin/admin-home';

export const metadata: Metadata = { title: 'Admin | EQOWA' };

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
      <AdminHome />
    </div>
  );
}
