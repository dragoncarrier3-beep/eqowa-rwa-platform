import type { AdminDocumentsResponse, DocumentDto, PublicDocumentsResponse } from '@config/api';

import { AdminError } from '@/lib/admin';
import { load } from '@/lib/portfolio';
import { proxied } from '@/lib/siwe';

export const fetchPublicDocuments = () => load<PublicDocumentsResponse>('/documents');
export const fetchAdminDocuments = () => load<AdminDocumentsResponse>('/admin/documents');

/** Plain links: the browser downloads with the session cookie, the API checks KYC. */
export const downloadUrl = (id: string) => proxied(`/documents/${encodeURIComponent(id)}/download`);
export const adminFileUrl = (id: string) => proxied(`/admin/documents/${encodeURIComponent(id)}/file`);

async function send<T>(route: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(proxied(route), { ...init, cache: 'no-store' });
  } catch {
    throw new AdminError('api_unreachable');
  }
  const json = (await response.json().catch(() => ({ ok: false, reason: 'api_unreachable' }))) as
    (T & { ok: true }) | { ok: false; reason: string };
  if (!json.ok) {
    throw new AdminError(json.reason);
  }
  return json;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const createDocument = (title: string, visibility: 'public' | 'kyc') =>
  send<{ document: DocumentDto }>('/admin/documents', jsonInit('POST', { title, visibility }));

export const uploadDocumentFile = (id: string, file: File) =>
  send<{ document: DocumentDto }>(`/admin/documents/${encodeURIComponent(id)}/file`, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent(file.name) },
    body: file,
  });

export const updateDocument = (id: string, patch: { title?: string; visibility?: 'public' | 'kyc' }) =>
  send<{ document: DocumentDto }>(`/admin/documents/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));

export const removeDocument = (id: string) => send(`/admin/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function fileSizeText(bytes: number | null): string {
  if (bytes === null) {
    return '';
  }
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
