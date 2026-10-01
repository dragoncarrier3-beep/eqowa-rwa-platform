'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { DocumentDto } from '@config/api';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText } from '@/lib/admin';
import {
  MAX_UPLOAD_BYTES,
  adminFileUrl,
  createDocument,
  fetchAdminDocuments,
  fileSizeText,
  removeDocument,
  updateDocument,
  uploadDocumentFile,
} from '@/lib/documents';

const INPUT = 'rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-text';

function checkFile(file: File | null): string | null {
  if (!file) {
    return 'Choose a PDF file.';
  }
  if (file.type && file.type !== 'application/pdf') {
    return 'Only PDF files can be published.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'The file is larger than 20 MB.';
  }
  return null;
}

function DocumentRow({ doc, canManage, onChange }: { doc: DocumentDto; canManage: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text">{doc.title}</span>
          <Badge tone={doc.status === 'ready' ? 'success' : 'warning'}>
            {doc.status === 'ready' ? 'Published' : 'Draft'}
          </Badge>
          <Badge tone={doc.visibility === 'public' ? 'primary' : 'neutral'}>
            {doc.visibility === 'public' ? 'Public' : 'Verified investors'}
          </Badge>
          {doc.filename ? (
            <a href={adminFileUrl(doc.id)} className="text-xs text-[#8fc1ef] hover:underline">
              {doc.filename} {fileSizeText(doc.size)}
            </a>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer text-xs text-[#8fc1ef] hover:underline">
              {doc.filename ? 'Replace PDF' : 'Upload PDF'}
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                aria-label={`PDF for ${doc.title}`}
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  const problem = checkFile(file);
                  if (problem) {
                    setError(problem);
                    return;
                  }
                  void run(() => uploadDocumentFile(doc.id, file!));
                }}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(() => updateDocument(doc.id, { visibility: doc.visibility === 'public' ? 'kyc' : 'public' }))
              }
            >
              {doc.visibility === 'public' ? 'Make KYC-only' : 'Make public'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => removeDocument(doc.id))}>
              Remove
            </Button>
          </div>
        ) : null}
      </div>
      {doc.sha256 ? <div className="font-mono text-xs text-text-faint">SHA-256 {doc.sha256}</div> : null}
      {error ? (
        <p role="alert" className="text-xs text-[#ff8a8e]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function AdminDocuments({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const documents = useQuery({ queryKey: ['admin-documents'], queryFn: fetchAdminDocuments });
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'kyc'>('kyc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-documents'] });

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createDocument(title.trim(), visibility);
      setTitle('');
      refresh();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <Card>
          <form onSubmit={create}>
            <CardHeader>
              <CardTitle>New document</CardTitle>
              <CardDescription>
                Create it, then upload the PDF. KYC-only documents are listed to everyone but only verified investors
                can download them.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <input
                aria-label="Document title"
                placeholder="Title, for example Offering memorandum"
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                className={`${INPUT} min-w-64 flex-1`}
              />
              <select
                aria-label="Who can download"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as 'public' | 'kyc')}
                className={INPUT}
              >
                <option value="kyc">Verified investors only</option>
                <option value="public">Anyone</option>
              </select>
              <Button type="submit" disabled={busy || !title.trim()}>
                Create
              </Button>
              {error ? (
                <p role="alert" className="w-full text-sm text-[#ff8a8e]">
                  {error}
                </p>
              ) : null}
            </CardContent>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.isPending ? (
            <p className="text-sm text-text-muted">Loading</p>
          ) : documents.data?.state !== 'ok' ? (
            <p className="text-sm text-warning">Documents could not be loaded.</p>
          ) : documents.data.data.documents.length === 0 ? (
            <p className="text-sm text-text-muted">
              No documents yet. Investors see &ldquo;Documents coming soon&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {documents.data.data.documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} canManage={canManage} onChange={refresh} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
