'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import type { AdminMeResponse } from '@config/api';

import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchAdminMe } from '@/lib/admin';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/admin', label: 'Overview', permission: 'dashboard:view' },
  { href: '/admin/purchases', label: 'Purchases', permission: 'quotes:view' },
  { href: '/admin/investors', label: 'Investors', permission: 'investors:view' },
  { href: '/admin/exceptions', label: 'Exceptions', permission: 'dashboard:view' },
  { href: '/admin/compliance', label: 'Compliance rules', permission: 'compliance:view' },
  { href: '/admin/controls', label: 'Token controls', permission: 'token:pause' },
  { href: '/admin/documents', label: 'Documents', permission: 'documents:view' },
  { href: '/admin/audit', label: 'Audit log', permission: 'audit:view' },
  { href: '/admin/team', label: 'Team', permission: 'team:view' },
  { href: '/admin/recovery', label: 'Key recovery', permission: 'recovery:request' },
  { href: '/admin/account', label: 'My keys', permission: null },
] as const;

/**
 * Frame of every signed-in admin page: section navigation limited to the
 * admin's role, and the second-key warning until two keys are enrolled.
 * The API enforces the same permissions; hiding here only avoids dead ends.
 */
export function AdminShell({ children }: { children: (me: AdminMeResponse) => ReactNode }) {
  const pathname = usePathname();
  const me = useQuery({ queryKey: ['admin-me'], queryFn: fetchAdminMe });

  if (me.isPending) {
    return <p className="text-sm text-text-muted">Loading</p>;
  }
  if (me.data?.state !== 'ok') {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Admin area</CardTitle>
          <CardDescription>Sign in with your security key to continue.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/admin/login" className="text-sm text-[#8fc1ef] hover:underline">
            Go to admin sign-in
          </Link>
        </CardFooter>
      </Card>
    );
  }
  const data = me.data.data;
  const allowed = new Set(data.permissions);

  return (
    <div className="space-y-6">
      <nav aria-label="Admin sections" className="flex flex-wrap gap-1 border-b border-border pb-2 text-sm">
        {SECTIONS.filter((section) => section.permission === null || allowed.has(section.permission)).map((section) => (
          <Link
            key={section.href}
            href={section.href}
            aria-current={pathname === section.href ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-text-muted hover:bg-surface-2 hover:text-text',
              pathname === section.href && 'bg-surface-2 text-text',
            )}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      {/* The account page shows its own, fuller version of this warning. */}
      {data.needsSecondKey && pathname !== '/admin/account' ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-panel border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <strong className="font-semibold">Add your second key.</strong> With only one key, losing it locks you out
            until the Safe signers approve a recovery.{' '}
            <Link href="/admin/account" className="underline">
              Register your spare key
            </Link>
            .
          </div>
        </div>
      ) : null}
      {children(data)}
    </div>
  );
}
