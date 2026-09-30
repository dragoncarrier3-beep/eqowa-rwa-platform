'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { AdminEnrol } from '@/components/admin/admin-enrol';

function EnrolFromLink() {
  const token = useSearchParams().get('token') ?? '';
  return <AdminEnrol token={token} />;
}

/** The invite token arrives in the link; reading it needs a client boundary. */
export default function AdminEnrolPage() {
  return (
    <Suspense fallback={<p className="text-sm text-text-muted">Loading</p>}>
      <EnrolFromLink />
    </Suspense>
  );
}
