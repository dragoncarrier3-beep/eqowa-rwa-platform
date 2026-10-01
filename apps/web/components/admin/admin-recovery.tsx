'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ADMIN_ROLE_LABELS } from '@config/adminRoles';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText, fetchTeam } from '@/lib/admin';
import {
  SAFE_TX_HASH,
  approveRecovery,
  fetchRecoveries,
  openRecovery,
  rejectRecovery,
  type RecoveryTicketDto,
} from '@/lib/admin-data';

const INPUT = 'rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-text';
const STATUS_TONE = { open: 'warning', approved: 'success', rejected: 'neutral' } as const;

function Decide({ ticket, onDone }: { ticket: RecoveryTicketDto; onDone: (inviteUrl?: string) => void }) {
  const [hash, setHash] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ inviteUrl?: string } | object>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      onDone('inviteUrl' in result ? String(result.inviteUrl) : undefined);
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        First confirm the person&apos;s identity outside the portal, then have two Safe signers record their agreement
        in the Safe app. Paste that Safe transaction hash to approve.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label={`Safe transaction hash for ${ticket.id}`}
          placeholder="Safe transaction hash 0x..."
          value={hash}
          onChange={(event) => setHash(event.target.value)}
          className={`${INPUT} min-w-72 flex-1 font-mono text-xs`}
        />
        <Button
          size="sm"
          variant="danger"
          disabled={busy || !SAFE_TX_HASH.test(hash.trim())}
          onClick={() => run(() => approveRecovery(ticket.id, hash.trim()))}
        >
          Approve and reset keys
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label={`Reason to reject ${ticket.id}`}
          placeholder="Reason to reject"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={`${INPUT} min-w-72 flex-1 text-xs`}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !note.trim()}
          onClick={() => run(() => rejectRecovery(ticket.id, note.trim()))}
        >
          Reject
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[#ff8a8e]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Break-glass for lost keys: one admin asks, a different operations admin approves with Safe evidence. */
export function AdminRecovery({ canApprove, myAdminId }: { canApprove: boolean; myAdminId: string }) {
  const queryClient = useQueryClient();
  const tickets = useQuery({ queryKey: ['admin-recovery'], queryFn: fetchRecoveries });
  const team = useQuery({ queryKey: ['admin-team'], queryFn: fetchTeam });
  const [form, setForm] = useState({ adminId: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-recovery'] });

  async function request(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await openRecovery(form.adminId, form.reason.trim());
      setForm({ adminId: '', reason: '' });
      refresh();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  const members = team.data?.state === 'ok' ? team.data.data.team.filter((member) => member.status !== 'disabled') : [];

  return (
    <div className="space-y-6">
      <Card>
        <form onSubmit={request}>
          <CardHeader>
            <CardTitle>Report lost keys</CardTitle>
            <CardDescription>
              For an admin who lost both security keys. Their keys are removed and they get a new invite once a
              different operations admin approves with the Safe signers&apos; agreement.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <select
              aria-label="Admin who lost access"
              value={form.adminId}
              onChange={(event) => setForm({ ...form, adminId: event.target.value })}
              className={INPUT}
            >
              <option value="">Choose the admin</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} ({member.email})
                </option>
              ))}
            </select>
            <input
              aria-label="What happened"
              placeholder="What happened"
              value={form.reason}
              maxLength={300}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              className={`${INPUT} min-w-64 flex-1`}
            />
            <Button type="submit" disabled={busy || !form.adminId || !form.reason.trim()}>
              Open recovery
            </Button>
            {error ? (
              <p role="alert" className="w-full text-sm text-[#ff8a8e]">
                {error}
              </p>
            ) : null}
          </CardContent>
        </form>
      </Card>

      {invite ? (
        <div role="status" className="space-y-1 rounded-panel border border-live/40 bg-live-soft p-3 text-sm">
          <p className="text-text">Keys reset. Send this new invite to the person directly; it is shown only once.</p>
          <code aria-label="New invite link" className="block break-all font-mono text-xs text-live">
            {invite}
          </code>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recoveries</CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.isPending ? (
            <p className="text-sm text-text-muted">Loading</p>
          ) : tickets.data?.state !== 'ok' ? (
            <p className="text-sm text-warning">Recoveries could not be loaded.</p>
          ) : tickets.data.data.tickets.length === 0 ? (
            <p className="text-sm text-text-muted">No recoveries so far.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.data.data.tickets.map((ticket) => (
                <li key={ticket.id} className="space-y-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-text">
                      {ticket.admin
                        ? `${ticket.admin.name} (${ADMIN_ROLE_LABELS[ticket.admin.role as keyof typeof ADMIN_ROLE_LABELS] ?? ticket.admin.role})`
                        : 'Unknown admin'}
                    </span>
                    <Badge tone={STATUS_TONE[ticket.status]}>{ticket.status}</Badge>
                  </div>
                  <div className="text-xs text-text-muted">
                    Opened by {ticket.requestedBy}: {ticket.reason}
                    {ticket.resolvedBy ? `. Decided by ${ticket.resolvedBy}: ${ticket.resolution}` : ''}
                  </div>
                  {ticket.status === 'open' && canApprove && ticket.admin?.id !== myAdminId ? (
                    <Decide
                      ticket={ticket}
                      onDone={(url) => {
                        if (url) {
                          setInvite(url);
                        }
                        refresh();
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
