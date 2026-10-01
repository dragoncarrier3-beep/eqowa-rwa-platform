'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { AdminInvestorDto } from '@config/api';
import { TOKEN_SYMBOL } from '@config/eqowa';

import { KycStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText } from '@/lib/admin';
import { fetchInvestors, setFrozen } from '@/lib/admin-data';
import { formatUnits6, shortAddress } from '@/lib/format';

const REGISTRATION_TONE = {
  registered: 'success',
  pending: 'neutral',
  identity_deployed: 'neutral',
  failed: 'danger',
} as const;

/** Freeze needs a reason: it is written to the audit log with the transaction. */
function FreezeControl({ investor, onDone }: { investor: AdminInvestorDto; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = investor.frozen ? 'Unfreeze' : 'Freeze';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setFrozen(investor.walletAddress, !investor.frozen, reason.trim());
      setOpen(false);
      setReason('');
      onDone();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant={investor.frozen ? 'secondary' : 'danger'} onClick={() => setOpen(true)}>
        {action}
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col items-end gap-1">
      <input
        aria-label={`Reason to ${action.toLowerCase()} ${investor.walletAddress}`}
        placeholder="Reason (kept in the audit log)"
        value={reason}
        maxLength={200}
        onChange={(event) => setReason(event.target.value)}
        className="w-56 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-text"
      />
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          variant={investor.frozen ? 'secondary' : 'danger'}
          disabled={busy || !reason.trim()}
        >
          {busy ? 'Sending' : `Confirm ${action.toLowerCase()}`}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[#ff8a8e]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function AdminInvestors({ canFreeze }: { canFreeze: boolean }) {
  const queryClient = useQueryClient();
  const investors = useQuery({ queryKey: ['admin-investors'], queryFn: fetchInvestors, refetchInterval: 30_000 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Investors</CardTitle>
        <CardDescription>
          KYC from Sumsub, on-chain registration, and holdings from the indexer (12 blocks behind the chain). A frozen
          wallet can neither send nor receive.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {investors.isPending ? (
          <p className="text-sm text-text-muted">Loading</p>
        ) : investors.data?.state !== 'ok' ? (
          <p className="text-sm text-warning">Investors could not be loaded.</p>
        ) : investors.data.data.investors.length === 0 ? (
          <p className="text-sm text-text-muted">No investors yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-text-faint">
              <tr>
                <th className="pb-2 font-medium">Wallet</th>
                <th className="pb-2 font-medium">KYC</th>
                <th className="pb-2 font-medium">On-chain</th>
                <th className="pb-2 text-right font-medium">Balance</th>
                <th className="pb-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {investors.data.data.investors.map((investor) => (
                <tr key={investor.walletAddress} className="border-t border-border align-top">
                  <td className="py-2">
                    <span className="font-mono">{shortAddress(investor.walletAddress)}</span>
                    {investor.frozen ? (
                      <Badge tone="danger" className="ml-2">
                        Frozen
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-2">
                    {investor.kycStatus ? (
                      <KycStatusBadge status={investor.kycStatus} />
                    ) : (
                      <span className="text-text-muted">No KYC record</span>
                    )}
                  </td>
                  <td className="py-2">
                    {investor.registration ? (
                      <Badge tone={REGISTRATION_TONE[investor.registration]}>
                        {investor.registration.replaceAll('_', ' ')}
                      </Badge>
                    ) : (
                      <span className="text-text-muted">n/a</span>
                    )}
                    {investor.registrationError ? (
                      <div className="mt-1 max-w-56 text-xs text-[#ff8a8e]">{investor.registrationError}</div>
                    ) : null}
                  </td>
                  <td className="py-2 text-right font-mono">
                    {formatUnits6(BigInt(investor.balance))} {TOKEN_SYMBOL}
                  </td>
                  <td className="py-2 text-right">
                    {canFreeze ? (
                      <FreezeControl
                        investor={investor}
                        onDone={() => void queryClient.invalidateQueries({ queryKey: ['admin-investors'] })}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
