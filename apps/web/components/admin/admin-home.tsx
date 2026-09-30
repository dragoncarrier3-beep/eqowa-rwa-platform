'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ADMIN_ROLE_LABELS } from '@config/adminRoles';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText, enrolKey, fetchAdminMe, removeKey, signOutAdmin } from '@/lib/admin';

const ME_KEY = ['admin-me'];

/** Admin account home: role, keys, and the push for a second key. The dashboard follows in M4-09. */
export function AdminHome() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchAdminMe });
  const [label, setLabel] = useState('YubiKey 2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const { admin, credentials, needsSecondKey, permissions } = me.data.data;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await signOutAdmin().catch(() => undefined);
    queryClient.removeQueries({ queryKey: ME_KEY });
    router.push('/admin/login');
  }

  return (
    <div className="space-y-6">
      {needsSecondKey ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-panel border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <strong className="font-semibold">Add your second key.</strong> With only one key, losing it locks you out
            until the Safe signers approve a recovery. Register your spare YubiKey now.
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{admin.name}</CardTitle>
              <CardDescription>{admin.email}</CardDescription>
            </div>
            <Badge tone="primary">{ADMIN_ROLE_LABELS[admin.role]}</Badge>
          </div>
        </CardHeader>
        <CardFooter className="gap-4">
          {permissions.includes('team:view') ? (
            <Link href="/admin/team" className="text-sm text-[#8fc1ef] hover:underline">
              Team
            </Link>
          ) : null}
          <Button size="sm" variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security keys</CardTitle>
          <CardDescription>Keep two keys: one on you, one stored safely.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y divide-border" aria-label="Registered keys">
            {credentials.map((credential) => (
              <li key={credential.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="text-text">{credential.label}</div>
                  <div className="text-xs text-text-muted">
                    Added {new Date(credential.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                    {credential.lastUsedAt
                      ? `, last used ${new Date(credential.lastUsedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`
                      : ', not used yet'}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || credentials.length <= 1}
                  onClick={() => run(() => removeKey(credential.id))}
                  aria-label={`Remove ${credential.label}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1.5">
              <span className="text-sm text-text-muted">New key name</span>
              <input
                value={label}
                maxLength={60}
                onChange={(event) => setLabel(event.target.value)}
                className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <Button
              variant={needsSecondKey ? 'primary' : 'secondary'}
              disabled={busy}
              onClick={() => run(() => enrolKey({ label: label.trim() || 'Security key' }))}
            >
              {busy ? 'Touch your key' : 'Add a key'}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[#ff8a8e]">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
