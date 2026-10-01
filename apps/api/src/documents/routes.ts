import type { FastifyInstance, FastifyReply } from 'fastify';

import type { DocumentDto } from '../../../../config/api.ts';

import type { AuditWriter, createAdminGuard } from '../auth/adminAuth.ts';
import { readSession, type AuthConfig } from '../auth/routes.ts';
import type { IdentityStore } from '../kyc/identityStore.ts';

import {
  sha256Hex,
  storageKeyFor,
  type DocumentRecord,
  type DocumentStore,
  type DocumentVisibility,
  type FileStorage,
} from './store.ts';

/** Investor documents are PDFs; 20 MB covers a prospectus with scans. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-');
const MAX_TITLE = 120;

export type DocumentRouteDeps = {
  guard: ReturnType<typeof createAdminGuard>;
  audit: AuditWriter;
  documents: DocumentStore;
  /** Unset makes uploads and downloads 503; the list still works. */
  storage?: FileStorage;
  auth?: AuthConfig;
  identities: IdentityStore;
  now: () => Date;
};

function toDto(record: DocumentRecord): DocumentDto {
  return {
    id: record.id,
    title: record.title,
    visibility: record.visibility,
    status: record.status,
    filename: record.filename,
    size: record.size,
    sha256: record.sha256,
    updatedAt: record.updatedAt.toISOString(),
  };
}

const isVisibility = (value: unknown): value is DocumentVisibility => value === 'public' || value === 'kyc';

/** A filename safe for a Content-Disposition header, whatever was uploaded. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .slice(0, 100);
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'document'}.pdf`;
}

function sendPdf(reply: FastifyReply, record: DocumentRecord, bytes: Buffer) {
  return reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `attachment; filename="${safeFilename(record.filename ?? record.title)}"`)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .send(bytes);
}

export function registerDocumentRoutes(app: FastifyInstance, deps: DocumentRouteDeps) {
  app.addContentTypeParser(
    'application/pdf',
    { parseAs: 'buffer', bodyLimit: MAX_DOCUMENT_BYTES },
    (_request, body, done) => done(null, body),
  );

  // ---- admin -------------------------------------------------------------

  app.get('/admin/documents', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'documents:view'))) {
      return reply;
    }
    return { ok: true, documents: (await deps.documents.list()).map(toDto) };
  });

  app.post('/admin/documents', async (request, reply) => {
    const admin = await deps.guard.authorize(request, reply, 'documents:manage');
    if (!admin) {
      return reply;
    }
    const body = (request.body ?? {}) as { title?: unknown; visibility?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    // KYC-only unless an admin deliberately makes a document public.
    const visibility = body.visibility === undefined ? 'kyc' : body.visibility;
    if (!title || title.length > MAX_TITLE || !isVisibility(visibility)) {
      return reply.code(400).send({ ok: false, reason: 'invalid_document' });
    }
    const record = await deps.documents.create({ title, visibility, uploadedBy: admin.actor, now: deps.now() });
    await deps.audit({ actor: admin.actor, action: 'document.created', payload: { id: record.id, title, visibility } });
    return { ok: true, document: toDto(record) };
  });

  app.put('/admin/documents/:id/file', async (request, reply) => {
    const admin = await deps.guard.authorize(request, reply, 'documents:manage');
    if (!admin) {
      return reply;
    }
    const { id } = request.params as { id: string };
    const record = await deps.documents.get(id);
    if (!record) {
      return reply.code(404).send({ ok: false, reason: 'unknown_document' });
    }
    const bytes = request.body;
    // Checked by content, not by name: only real PDFs are accepted.
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || !bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      return reply.code(415).send({ ok: false, reason: 'pdf_required' });
    }
    if (!deps.storage) {
      return reply.code(503).send({ ok: false, reason: 'storage_unavailable' });
    }

    const header = request.headers['x-filename'];
    const filename = safeFilename(typeof header === 'string' ? decodeURIComponent(header) : record.title);
    const storageKey = storageKeyFor(record.id);
    const sha256 = sha256Hex(bytes);
    await deps.storage.put(storageKey, bytes);
    await deps.documents.attachFile(
      record.id,
      { filename, size: bytes.length, sha256, storageKey, uploadedBy: admin.actor },
      deps.now(),
    );
    if (record.storageKey) {
      await deps.storage.delete(record.storageKey).catch(() => undefined);
    }
    await deps.audit({
      actor: admin.actor,
      action: record.storageKey ? 'document.replaced' : 'document.uploaded',
      payload: { id: record.id, filename, size: bytes.length, sha256 },
    });
    return { ok: true, document: toDto((await deps.documents.get(record.id))!) };
  });

  app.patch('/admin/documents/:id', async (request, reply) => {
    const admin = await deps.guard.authorize(request, reply, 'documents:manage');
    if (!admin) {
      return reply;
    }
    const { id } = request.params as { id: string };
    if (!(await deps.documents.get(id))) {
      return reply.code(404).send({ ok: false, reason: 'unknown_document' });
    }
    const body = (request.body ?? {}) as { title?: unknown; visibility?: unknown };
    const patch: { title?: string; visibility?: DocumentVisibility } = {};
    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > MAX_TITLE) {
        return reply.code(400).send({ ok: false, reason: 'invalid_document' });
      }
      patch.title = title;
    }
    if (body.visibility !== undefined) {
      if (!isVisibility(body.visibility)) {
        return reply.code(400).send({ ok: false, reason: 'invalid_document' });
      }
      patch.visibility = body.visibility;
    }
    await deps.documents.update(id, patch, deps.now());
    await deps.audit({ actor: admin.actor, action: 'document.updated', payload: { id, ...patch } });
    return { ok: true, document: toDto((await deps.documents.get(id))!) };
  });

  app.delete('/admin/documents/:id', async (request, reply) => {
    const admin = await deps.guard.authorize(request, reply, 'documents:manage');
    if (!admin) {
      return reply;
    }
    const { id } = request.params as { id: string };
    const record = await deps.documents.get(id);
    if (!record) {
      return reply.code(404).send({ ok: false, reason: 'unknown_document' });
    }
    await deps.documents.remove(id, deps.now());
    await deps.audit({ actor: admin.actor, action: 'document.removed', payload: { id, title: record.title } });
    return { ok: true };
  });

  app.get('/admin/documents/:id/file', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'documents:view'))) {
      return reply;
    }
    const { id } = request.params as { id: string };
    const record = await deps.documents.get(id);
    const bytes = record?.storageKey && deps.storage ? await deps.storage.get(record.storageKey) : null;
    if (!record || !bytes) {
      return reply.code(404).send({ ok: false, reason: 'unknown_document' });
    }
    return sendPdf(reply, record, bytes);
  });

  // ---- investors and the public -----------------------------------------

  async function verifiedInvestor(request: Parameters<typeof readSession>[0]) {
    if (!deps.auth) {
      return false;
    }
    const session = readSession(request, deps.auth, deps.now());
    const identity = session ? await deps.identities.getByWallet(session.walletAddress) : undefined;
    return identity?.kycStatus === 'approved';
  }

  app.get('/documents', async (request) => {
    const verified = await verifiedInvestor(request);
    const ready = (await deps.documents.list()).filter((record) => record.status === 'ready');
    // KYC-only titles are listed to everyone so investors know they exist, locked until verified.
    return {
      ok: true,
      verified,
      documents: ready.map((record) => ({
        ...toDto(record),
        sha256: record.visibility === 'public' || verified ? record.sha256 : null,
        available: record.visibility === 'public' || verified,
      })),
    };
  });

  app.get('/documents/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await deps.documents.get(id);
    if (!record || record.status !== 'ready' || !record.storageKey) {
      return reply.code(404).send({ ok: false, reason: 'unknown_document' });
    }
    if (record.visibility === 'kyc' && !(await verifiedInvestor(request))) {
      return reply.code(403).send({ ok: false, reason: 'kyc_required' });
    }
    const bytes = deps.storage ? await deps.storage.get(record.storageKey) : null;
    if (!bytes) {
      return reply.code(503).send({ ok: false, reason: 'storage_unavailable' });
    }
    return sendPdf(reply, record, bytes);
  });
}
