import type { Metadata } from 'next';

import { DocumentsList } from '@/components/documents-list';

export const metadata: Metadata = { title: 'Documents | EQOWA' };

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
      <DocumentsList />
    </div>
  );
}
