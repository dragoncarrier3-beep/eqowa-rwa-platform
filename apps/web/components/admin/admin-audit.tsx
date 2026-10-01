'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchAudit } from '@/lib/admin-data';

/** Append-only record of every mint, approval, freeze, login and key change. */
export function AdminAudit() {
  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: () => fetchAudit(200) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Newest first. Entries cannot be edited or deleted.</CardDescription>
      </CardHeader>
      <CardContent>
        {audit.isPending ? (
          <p className="text-sm text-text-muted">Loading</p>
        ) : audit.data?.state !== 'ok' ? (
          <p className="text-sm text-warning">The audit log could not be loaded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-text-faint">
              <tr>
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Who</th>
                <th className="pb-2 font-medium">What</th>
                <th className="pb-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.data.audit.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap py-2 text-xs text-text-muted">
                    {new Date(row.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="py-2">{row.actor}</td>
                  <td className="py-2 font-mono text-xs">{row.action}</td>
                  <td className="max-w-md break-all py-2 font-mono text-xs text-text-muted">
                    {JSON.stringify(row.payload)}
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
