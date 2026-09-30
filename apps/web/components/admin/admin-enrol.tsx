'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ADMIN_ROLE_LABELS } from '@config/adminRoles';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText, enrolKey, inspectInvite } from '@/lib/admin';

/** Opened from the invite link: registers the admin's first security key. */
export function AdminEnrol({ token }: { token: string }) {
  const router = useRouter();
  const [label, setLabel] = useState('YubiKey 1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => inspectInvite(token),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token || invite.isError) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Invite link not valid</CardTitle>
          <CardDescription>
            The link is incomplete, already used or expired (links last 72 hours). Ask EQOWA operations for a new one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (invite.isPending) {
    return <p className="text-sm text-text-muted">Checking the invite</p>;
  }
  const { admin } = invite.data;

  async function register() {
    setBusy(true);
    setError(null);
    try {
      await enrolKey({ token, label: label.trim() || 'Security key' });
      router.push('/admin');
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>Register your security key</CardTitle>
        <CardDescription>
          Welcome {admin.name}. You are joining as {ADMIN_ROLE_LABELS[admin.role]}. Plug in your YubiKey, choose a name
          for it and touch it when it blinks. You will add your second key right after.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-muted">
          Signing in as <span className="font-mono text-text">{admin.email}</span>
        </p>
        <label className="block space-y-1.5">
          <span className="text-sm text-text-muted">Key name</span>
          <input
            value={label}
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-[#ff8a8e]">
            {error}
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button onClick={register} disabled={busy}>
          {busy ? 'Touch your key' : 'Register security key'}
        </Button>
      </CardFooter>
    </Card>
  );
}
