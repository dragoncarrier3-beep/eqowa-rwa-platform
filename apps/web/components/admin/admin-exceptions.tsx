'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText } from '@/lib/admin';
import { exceptionText, fetchExceptions, resolveException, type AdminException } from '@/lib/admin-data';
import { shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

function ResolveForm({ exception, onDone }: { exception: AdminException; onDone: () => void }) {
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resolveException(exception.id, resolution.trim());
      onDone();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 sm:flex-row sm:items-center">
      <input
        aria-label={`Resolution for ${exception.id}`}
        placeholder="What was done, for example: refunded 2 USDT, Safe tx 0x..."
        value={resolution}
        onChange={(event) => setResolution(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-text"
      />
      <Button type="submit" size="sm" disabled={busy || !resolution.trim()}>
        Resolve
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-[#ff8a8e]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Payments the pipeline would not mint automatically; each one needs a person to close it. */
export function AdminExceptions({ canResolve }: { canResolve: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const exceptions = useQuery({ queryKey: ['admin-exceptions', status], queryFn: () => fetchExceptions(status) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exception queue</CardTitle>
        <CardDescription>
          Refunds of USDT held in escrow are Safe transactions; record what was done when closing an item.
        </CardDescription>
        <div role="tablist" aria-label="Exception status" className="flex gap-1 pt-2">
          {(['open', 'resolved'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={status === value}
              onClick={() => setStatus(value)}
              className={cn(
                'rounded-md border border-border px-2.5 py-1 text-xs capitalize text-text-muted',
                status === value && 'border-primary bg-primary-soft text-text',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {exceptions.isPending ? (
          <p className="text-sm text-text-muted">Loading</p>
        ) : exceptions.data?.state !== 'ok' ? (
          <p className="text-sm text-warning">Exceptions could not be loaded.</p>
        ) : exceptions.data.data.exceptions.length === 0 ? (
          <p className="text-sm text-text-muted">
            {status === 'open' ? 'Nothing needs attention.' : 'None resolved yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {exceptions.data.data.exceptions.map((exception) => (
              <li key={exception.id} className="space-y-2 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-text">{exceptionText(exception.kind)}</span>
                  <span className="text-xs text-text-muted">
                    {new Date(exception.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>
                {exception.intentId ? (
                  <div className="text-xs text-text-muted">
                    Reference <span className="font-mono">{shortAddress(exception.intentId)}</span>
                  </div>
                ) : null}
                {exception.status === 'resolved' ? (
                  <div className="text-xs text-text-muted">
                    Resolved by {exception.resolvedBy}: {exception.resolution}
                  </div>
                ) : canResolve ? (
                  <ResolveForm
                    exception={exception}
                    onDone={() => void queryClient.invalidateQueries({ queryKey: ['admin-exceptions'] })}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
