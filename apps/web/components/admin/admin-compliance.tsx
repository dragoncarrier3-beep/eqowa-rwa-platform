'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { StatTile } from '@/components/stat-tile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText } from '@/lib/admin';
import { fetchCompliance, fetchCountries, prepareCompliance, type ComplianceChangeInput } from '@/lib/admin-data';

const CHANGES = [
  { kind: 'maxBalance', label: 'Holding limit per investor (shares)' },
  { kind: 'maxHolderCount', label: 'Maximum number of holders' },
  { kind: 'dailyMintCap', label: '24-hour issuance limit (shares)' },
  { kind: 'lockupDays', label: 'Lock-up for new purchases (days)' },
  { kind: 'allowCountries', label: 'Allow countries (ISO numeric codes)' },
  { kind: 'disallowCountries', label: 'Block countries (ISO numeric codes)' },
] as const;

function parseCodes(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map(Number)
    .filter((code) => Number.isInteger(code) && code > 0 && code < 1000);
}

function CountryCheck() {
  const [text, setText] = useState('566, 840');
  const [codes, setCodes] = useState<number[]>([]);
  const result = useQuery({
    queryKey: ['admin-countries', codes.join(',')],
    queryFn: () => fetchCountries(codes),
    enabled: codes.length > 0,
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          aria-label="Country codes to check"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-text"
        />
        <Button variant="secondary" onClick={() => setCodes(parseCodes(text))}>
          Check
        </Button>
      </div>
      {result.data?.state === 'ok' ? (
        <ul className="flex flex-wrap gap-2 text-sm" aria-label="Country results">
          {result.data.data.countries.map((country) => (
            <li key={country.code} className={country.allowed ? 'text-success' : 'text-[#ff8a8e]'}>
              {country.code}: {country.allowed ? 'allowed' : 'blocked'}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Operations prepares; the Safe signers decide. Nothing here changes the chain by itself. */
function PrepareChange() {
  const [kind, setKind] = useState<(typeof CHANGES)[number]['kind']>('maxBalance');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ description: string; href: string; name: string } | null>(null);
  const countryChange = kind === 'allowCountries' || kind === 'disallowCountries';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPrepared(null);
    try {
      const change: ComplianceChangeInput = countryChange
        ? { kind, countries: parseCodes(value) }
        : { kind, value: value.trim() };
      const result = await prepareCompliance(change);
      setPrepared({
        description: result.description,
        href: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.file, null, 2))}`,
        name: `eqowa-compliance-${kind}.json`,
      });
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label="Rule to change"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
          className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-text"
        >
          {CHANGES.map((change) => (
            <option key={change.kind} value={change.kind}>
              {change.label}
            </option>
          ))}
        </select>
        <input
          aria-label="New value"
          placeholder={countryChange ? 'For example 840, 124' : 'New value'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-text"
        />
      </div>
      <Button type="submit" disabled={busy || !value.trim()}>
        Prepare Safe transaction
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-[#ff8a8e]">
          {error}
        </p>
      ) : null}
      {prepared ? (
        <div className="space-y-2 rounded-panel border border-live/40 bg-live-soft p-3 text-sm">
          <p className="text-text">{prepared.description}.</p>
          <p className="text-text-muted">
            Open the Safe app, Apps, Transaction Builder, drop this file in, then two signers review and approve it.
          </p>
          <a
            href={prepared.href}
            download={prepared.name}
            className="inline-flex items-center gap-2 text-[#8fc1ef] hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Download Safe batch file
          </a>
        </div>
      ) : null}
    </form>
  );
}

export function AdminCompliance({ canPrepare }: { canPrepare: boolean }) {
  const compliance = useQuery({ queryKey: ['admin-compliance'], queryFn: fetchCompliance });
  if (compliance.isPending) {
    return <p className="text-sm text-text-muted">Loading</p>;
  }
  if (compliance.data?.state !== 'ok') {
    return <p className="text-sm text-warning">The rules could not be read from the chain.</p>;
  }
  const { rules, safe, blockNumber } = compliance.data.data;
  const shown = (value: string | null) => (value === null ? 'n/a' : Number(value).toLocaleString('en-US'));

  return (
    <div className="space-y-6">
      <section aria-label="Live rules" className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Holding limit"
          value={shown(rules.maxBalanceShares)}
          unit="shares"
          hint="Per investor identity"
        />
        <StatTile
          label="Holders"
          value={`${shown(rules.holderCount)} / ${shown(rules.maxHolderCount)}`}
          hint="Current and maximum"
        />
        <StatTile
          label="Issuance today"
          value={shown(rules.remainingMintShares)}
          unit="left"
          hint={`of ${shown(rules.dailyMintCapShares)} shares per 24 hours`}
        />
        <StatTile label="Lock-up" value={shown(rules.lockupDays)} unit="days" hint="Per purchase" />
      </section>
      <p className="text-xs text-text-faint">
        Read live from the chain at block {blockNumber.toLocaleString('en-US')}.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Countries</CardTitle>
          <CardDescription>Check whether investors from a country may hold the token.</CardDescription>
        </CardHeader>
        <CardContent>
          <CountryCheck />
        </CardContent>
      </Card>

      {canPrepare ? (
        <Card>
          <CardHeader>
            <CardTitle>Change a rule</CardTitle>
            <CardDescription>
              Rules belong to the EQOWA Safe{safe ? ` (${safe})` : ''}, not to this portal. This prepares the change as
              a Safe Transaction Builder file for two signers to approve.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PrepareChange />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
