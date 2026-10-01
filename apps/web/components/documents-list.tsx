'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, Lock } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { downloadUrl, fetchPublicDocuments, fileSizeText } from '@/lib/documents';

/** Investor documents for EQOWA Group Shares. Shows "coming soon" until Eqowa publishes the first one. */
export function DocumentsList() {
  const documents = useQuery({ queryKey: ['documents'], queryFn: fetchPublicDocuments });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>Offering documents and reports for EQOWA Group Shares.</CardDescription>
      </CardHeader>
      <CardContent>
        {documents.isPending ? (
          <p className="text-sm text-text-muted">Loading</p>
        ) : documents.data?.state !== 'ok' ? (
          <p className="text-sm text-text-muted">Documents are not available right now.</p>
        ) : documents.data.data.documents.length === 0 ? (
          <p className="text-sm text-text-muted">Documents coming soon.</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.data.data.documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-text-muted" aria-hidden />
                  <span className="text-text">{doc.title}</span>
                  <span className="text-xs text-text-faint">{fileSizeText(doc.size)}</span>
                  {doc.visibility === 'kyc' ? <Badge tone="neutral">Verified investors</Badge> : null}
                </div>
                {doc.available ? (
                  <a href={downloadUrl(doc.id)} className="text-[#8fc1ef] hover:underline" download>
                    Download PDF
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                    <Lock className="size-3.5" aria-hidden />
                    <Link href="/kyc" className="hover:underline">
                      Verify your identity to download
                    </Link>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
