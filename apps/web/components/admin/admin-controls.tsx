'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { TOKEN_SYMBOL } from '@config/eqowa';

import { TxLink } from '@/components/tx-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText } from '@/lib/admin';
import { fetchCompliance, runTokenAction, type TokenAction } from '@/lib/admin-data';
import { APP_CHAIN_ID } from '@/lib/chain';

const INPUT = 'w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-text';

function useAction() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; txHash: string | null } | null>(null);

  async function run(action: TokenAction, body: { reason: string; wallet?: string; shares?: string }, text: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await runTokenAction(action, body);
      setDone({ text: result.changed ? text : 'Already in that state; nothing was sent.', txHash: result.txHash });
      await queryClient.invalidateQueries({ queryKey: ['admin-compliance'] });
      return true;
    } catch (caught) {
      setError(adminErrorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, done };
}

function Outcome({ error, done }: { error: string | null; done: { text: string; txHash: string | null } | null }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-[#ff8a8e]">
        {error}
      </p>
    );
  }
  if (done) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-success">
        {done.text}
        {done.txHash ? <TxLink chainId={APP_CHAIN_ID} hash={done.txHash} label="Transaction" /> : null}
      </p>
    );
  }
  return null;
}

function PauseCard({ paused }: { paused: boolean | null }) {
  const [reason, setReason] = useState('');
  const { run, busy, error, done } = useAction();
  const next = paused ? 'unpause' : 'pause';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trading</CardTitle>
          {paused === null ? null : <Badge tone={paused ? 'danger' : 'success'}>{paused ? 'Paused' : 'Active'}</Badge>}
        </div>
        <CardDescription>
          Pausing stops every transfer between investors at once. Purchases already paid still mint.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          aria-label="Reason to change trading"
          placeholder="Reason (kept in the audit log)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={INPUT}
        />
        <Button
          variant={paused ? 'secondary' : 'danger'}
          disabled={busy || !reason.trim() || paused === null}
          onClick={async () => {
            if (await run(next, { reason: reason.trim() }, paused ? 'Trading resumed.' : 'Trading paused.')) {
              setReason('');
            }
          }}
        >
          {paused ? 'Resume trading' : 'Pause trading'}
        </Button>
        <Outcome error={error} done={done} />
      </CardContent>
    </Card>
  );
}

function SupplyCard({ action }: { action: 'mint' | 'burn' }) {
  const [form, setForm] = useState({ wallet: '', shares: '', reason: '' });
  const { run, busy, error, done } = useAction();
  const ready = form.wallet.trim() && /^\d+$/.test(form.shares) && Number(form.shares) > 0 && form.reason.trim();
  const title = action === 'mint' ? 'Mint shares' : 'Burn shares';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {action === 'mint'
            ? 'Outside the payment flow, for corrections and agreed allocations. The token still checks identity, country, the holding limit and the daily limit.'
            : 'Removes shares from a wallet, for redemptions and corrections.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          aria-label={`Wallet to ${action}`}
          placeholder="Wallet 0x..."
          value={form.wallet}
          onChange={(event) => setForm({ ...form, wallet: event.target.value })}
          className={`${INPUT} font-mono`}
        />
        <input
          aria-label={`Shares to ${action}`}
          inputMode="numeric"
          placeholder={`Whole ${TOKEN_SYMBOL} shares`}
          value={form.shares}
          onChange={(event) => setForm({ ...form, shares: event.target.value.replace(/[^\d]/g, '') })}
          className={INPUT}
        />
        <input
          aria-label={`Reason to ${action}`}
          placeholder="Reason (kept in the audit log)"
          value={form.reason}
          onChange={(event) => setForm({ ...form, reason: event.target.value })}
          className={INPUT}
        />
        <Button
          variant={action === 'burn' ? 'danger' : 'primary'}
          disabled={busy || !ready}
          onClick={async () => {
            const ok = await run(
              action,
              { wallet: form.wallet.trim(), shares: form.shares, reason: form.reason.trim() },
              `${form.shares} shares ${action === 'mint' ? 'minted' : 'burned'}.`,
            );
            if (ok) {
              setForm({ wallet: '', shares: '', reason: '' });
            }
          }}
        >
          {busy ? 'Sending' : title}
        </Button>
        <Outcome error={error} done={done} />
      </CardContent>
    </Card>
  );
}

/** Operations only. Every action is signed by the agent key and audited with its reason. */
export function AdminControls() {
  const compliance = useQuery({ queryKey: ['admin-compliance'], queryFn: fetchCompliance });
  const paused = compliance.data?.state === 'ok' ? compliance.data.data.paused : null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <PauseCard paused={paused} />
      <SupplyCard action="mint" />
      <SupplyCard action="burn" />
    </div>
  );
}
