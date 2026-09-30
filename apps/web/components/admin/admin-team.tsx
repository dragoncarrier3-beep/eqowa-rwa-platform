'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ADMIN_ROLES, ADMIN_ROLE_LABELS } from '@config/adminRoles';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText, fetchAdminMe, fetchTeam, inviteMember } from '@/lib/admin';

const STATUS_TONE = { active: 'success', invited: 'warning', disabled: 'danger' } as const;

/** Team list for every admin; the invite form only for roles with team:manage. */
export function AdminTeam() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['admin-me'], queryFn: fetchAdminMe });
  const team = useQuery({ queryKey: ['admin-team'], queryFn: fetchTeam });
  const [form, setForm] = useState({ email: '', name: '', role: 'compliance' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string; expiresAt: string } | null>(null);

  if (me.isPending || team.isPending) {
    return <p className="text-sm text-text-muted">Loading</p>;
  }
  if (me.data?.state !== 'ok' || team.data?.state !== 'ok') {
    return (
      <p className="text-sm text-text-muted">
        <Link href="/admin/login" className="text-[#8fc1ef] hover:underline">
          Sign in
        </Link>{' '}
        with an admin role that can view the team.
      </p>
    );
  }
  const canInvite = me.data.data.permissions.includes('team:manage');

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const result = await inviteMember(form);
      setLink({ email: result.admin.email, url: result.inviteUrl, expiresAt: result.expiresAt });
      setForm({ email: '', name: '', role: form.role });
      await queryClient.invalidateQueries({ queryKey: ['admin-team'] });
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Every admin signs in with their own security keys. Two keys each.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-text-faint">
              <tr>
                <th className="pb-2 font-medium">Admin</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Keys</th>
              </tr>
            </thead>
            <tbody>
              {team.data.data.team.map((member) => (
                <tr key={member.id} className="border-t border-border">
                  <td className="py-2">
                    <div className="text-text">{member.name}</div>
                    <div className="text-xs text-text-muted">{member.email}</div>
                  </td>
                  <td className="py-2">{ADMIN_ROLE_LABELS[member.role]}</td>
                  <td className="py-2">
                    <Badge tone={STATUS_TONE[member.status]}>{member.status}</Badge>
                  </td>
                  <td className={member.credentialCount < 2 ? 'py-2 text-right text-warning' : 'py-2 text-right'}>
                    {member.credentialCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canInvite ? (
        <Card>
          <form onSubmit={invite}>
            <CardHeader>
              <CardTitle>Invite an admin</CardTitle>
              <CardDescription>
                The link works once, for 72 hours. Send it to the person directly; whoever opens it registers the key.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <input
                type="email"
                required
                placeholder="Email"
                aria-label="Email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-text"
              />
              <input
                placeholder="Name"
                aria-label="Name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-text"
              />
              <select
                aria-label="Role"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
                className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-text"
              >
                {ADMIN_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ADMIN_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <div className="sm:col-span-3">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Creating' : 'Create invite link'}
                </Button>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-[#ff8a8e] sm:col-span-3">
                  {error}
                </p>
              ) : null}
              {link ? (
                <div className="space-y-2 rounded-panel border border-live/40 bg-live-soft p-3 text-sm sm:col-span-3">
                  <p className="text-text">
                    Invite for {link.email}. Shown only once; valid until{' '}
                    {new Date(link.expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs text-live" aria-label="Invite link">
                      {link.url}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void navigator.clipboard?.writeText(link.url)}
                    >
                      <Copy className="size-4" aria-hidden />
                      Copy
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
