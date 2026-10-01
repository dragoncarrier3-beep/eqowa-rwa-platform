import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AdminAuthConfig } from '../auth/adminAuth.ts';
import { MemoryAdminStore } from '../auth/adminStore.ts';
import type { AuthConfig } from '../auth/routes.ts';
import { signAdminSession, signSession } from '../auth/session.ts';
import { buildApp } from '../index.ts';
import { MemoryIdentityStore } from '../kyc/identityStore.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';

import { DiskStorage, MemoryDocumentStore, MemoryStorage, sha256Hex } from './store.ts';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const PDF = Buffer.from('%PDF-1.7\n% EQOWA offering memorandum test\n%%EOF\n');
const VERIFIED = '0x1111111111111111111111111111111111111111';
const PENDING = '0x2222222222222222222222222222222222222222';
const SECRET = 'test-secret-that-is-at-least-32-characters';
const ADMIN_AUTH: AdminAuthConfig = {
  secret: SECRET,
  cookieName: 'eqowa_admin',
  secureCookie: true,
  rpID: 'app.eqowa.com',
  rpName: 'EQOWA Admin',
  origin: 'https://app.eqowa.com',
};
const AUTH: AuthConfig = {
  secret: SECRET,
  cookieName: 'eqowa_session',
  secureCookie: true,
  siweDomain: 'app.eqowa.com',
  chainId: 80002,
};

async function setup(options: { withStorage?: boolean } = {}) {
  const adminStore = new MemoryAdminStore();
  const identities = new MemoryIdentityStore();
  const mintStore = new MemoryMintStore();
  const storage = new MemoryStorage();
  const cookies: Record<string, string> = {};
  for (const role of ['ceo', 'compliance', 'operations'] as const) {
    const admin = await adminStore.createAdmin({ email: `${role}@eqowa.com`, name: role, role, now: NOW });
    await adminStore.setStatus(admin.id, 'active');
    cookies[role] = `eqowa_admin=${signAdminSession(
      { kind: 'admin', adminId: admin.id, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000) },
      SECRET,
    )}`;
  }
  const base = { onchainIdAddress: '0x9999999999999999999999999999999999999999', countryCode: 566, claims: [1, 2] };
  await identities.recordKyc({ ...base, walletAddress: VERIFIED, kycStatus: 'approved', applicantId: 'a' });
  await identities.recordKyc({ ...base, walletAddress: PENDING, kycStatus: 'pending', applicantId: 'b' });
  for (const wallet of [VERIFIED, PENDING]) {
    cookies[wallet] = `eqowa_session=${signSession(
      { kind: 'investor', walletAddress: wallet, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000) },
      SECRET,
    )}`;
  }
  const app = buildApp({
    auth: AUTH,
    adminAuth: ADMIN_AUTH,
    adminStore,
    identityStore: identities,
    mintStore,
    documents: new MemoryDocumentStore(),
    documentStorage: options.withStorage === false ? undefined : storage,
    now: () => NOW,
  });
  return { app, cookies, storage, mintStore };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function createAndUpload(env: Env, title: string, visibility?: 'public' | 'kyc') {
  const created = await env.app.inject({
    method: 'POST',
    url: '/admin/documents',
    payload: { title, visibility },
    headers: { cookie: env.cookies.operations },
  });
  assert.equal(created.statusCode, 200, created.body);
  const { id } = created.json().document;
  const uploaded = await env.app.inject({
    method: 'PUT',
    url: `/admin/documents/${id}/file`,
    payload: PDF,
    headers: {
      cookie: env.cookies.operations,
      'content-type': 'application/pdf',
      'x-filename': encodeURIComponent('Offering Memorandum.pdf'),
    },
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  return uploaded.json().document as { id: string; status: string; sha256: string; visibility: string };
}

test('operations publishes a PDF, KYC-only by default, with its fingerprint; other roles cannot', async () => {
  const env = await setup();
  const doc = await createAndUpload(env, 'Offering memorandum');
  assert.equal(doc.visibility, 'kyc');
  assert.equal(doc.status, 'ready');
  assert.equal(doc.sha256, sha256Hex(PDF));
  const [latest] = await env.mintStore.listAudit();
  assert.equal(latest.action, 'document.uploaded');
  assert.equal(latest.actor, 'operations@eqowa.com');

  const refused = await env.app.inject({
    method: 'POST',
    url: '/admin/documents',
    payload: { title: 'x' },
    headers: { cookie: env.cookies.compliance },
  });
  assert.equal(refused.statusCode, 403);
  const listed = await env.app.inject({ method: 'GET', url: '/admin/documents', headers: { cookie: env.cookies.ceo } });
  assert.equal(listed.json().documents.length, 1);
});

test('only real PDFs are accepted, and not without storage', async () => {
  const env = await setup();
  const created = await env.app.inject({
    method: 'POST',
    url: '/admin/documents',
    payload: { title: 'Fake' },
    headers: { cookie: env.cookies.operations },
  });
  const { id } = created.json().document;
  const fake = await env.app.inject({
    method: 'PUT',
    url: `/admin/documents/${id}/file`,
    payload: Buffer.from('MZ this is an executable'),
    headers: { cookie: env.cookies.operations, 'content-type': 'application/pdf' },
  });
  assert.equal(fake.statusCode, 415);
  assert.equal(fake.json().reason, 'pdf_required');

  const noStorage = await setup({ withStorage: false });
  const draft = await noStorage.app.inject({
    method: 'POST',
    url: '/admin/documents',
    payload: { title: 'x' },
    headers: { cookie: noStorage.cookies.operations },
  });
  const upload = await noStorage.app.inject({
    method: 'PUT',
    url: `/admin/documents/${draft.json().document.id}/file`,
    payload: PDF,
    headers: { cookie: noStorage.cookies.operations, 'content-type': 'application/pdf' },
  });
  assert.equal(upload.statusCode, 503);
});

test('public documents download for anyone; KYC-only ones only for verified investors', async () => {
  const env = await setup();
  const publicDoc = await createAndUpload(env, 'Company profile', 'public');
  const kycDoc = await createAndUpload(env, 'Offering memorandum', 'kyc');

  const anonymous = (await env.app.inject({ method: 'GET', url: '/documents' })).json();
  assert.equal(anonymous.verified, false);
  assert.deepEqual(
    anonymous.documents.map((doc: { title: string; available: boolean; sha256: string | null }) => [
      doc.title,
      doc.available,
      doc.sha256 !== null,
    ]),
    [
      ['Offering memorandum', false, false],
      ['Company profile', true, true],
    ],
  );

  const open = await env.app.inject({ method: 'GET', url: `/documents/${publicDoc.id}/download` });
  assert.equal(open.statusCode, 200);
  assert.equal(open.headers['content-type'], 'application/pdf');
  assert.match(String(open.headers['content-disposition']), /attachment; filename="Offering Memorandum.pdf"/);
  assert.equal(open.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(open.rawPayload, PDF);

  const download = (cookie?: string) =>
    env.app.inject({ method: 'GET', url: `/documents/${kycDoc.id}/download`, headers: cookie ? { cookie } : {} });
  assert.equal((await download()).statusCode, 403);
  assert.equal((await download(env.cookies[PENDING])).statusCode, 403);
  const verified = await download(env.cookies[VERIFIED]);
  assert.equal(verified.statusCode, 200);
  assert.deepEqual(verified.rawPayload, PDF);

  const asVerified = (
    await env.app.inject({ method: 'GET', url: '/documents', headers: { cookie: env.cookies[VERIFIED] } })
  ).json();
  assert.equal(asVerified.verified, true);
  assert.ok(asVerified.documents.every((doc: { available: boolean }) => doc.available));
});

test('drafts stay hidden; replacing drops the old file; removing hides the document', async () => {
  const env = await setup();
  await env.app.inject({
    method: 'POST',
    url: '/admin/documents',
    payload: { title: 'Draft only' },
    headers: { cookie: env.cookies.operations },
  });
  const doc = await createAndUpload(env, 'Annual report', 'public');
  assert.deepEqual(
    (await env.app.inject({ method: 'GET', url: '/documents' }))
      .json()
      .documents.map((d: { title: string }) => d.title),
    ['Annual report'],
  );

  const firstKeys = [...env.storage.files.keys()];
  const replacement = Buffer.from('%PDF-1.7\n% version 2\n%%EOF\n');
  const replaced = await env.app.inject({
    method: 'PUT',
    url: `/admin/documents/${doc.id}/file`,
    payload: replacement,
    headers: { cookie: env.cookies.operations, 'content-type': 'application/pdf' },
  });
  assert.equal(replaced.json().document.sha256, sha256Hex(replacement));
  assert.equal(env.storage.files.size, 1);
  assert.notDeepEqual([...env.storage.files.keys()], firstKeys);
  assert.equal((await env.mintStore.listAudit())[0].action, 'document.replaced');

  const patched = await env.app.inject({
    method: 'PATCH',
    url: `/admin/documents/${doc.id}`,
    payload: { visibility: 'kyc' },
    headers: { cookie: env.cookies.operations },
  });
  assert.equal(patched.json().document.visibility, 'kyc');

  const removed = await env.app.inject({
    method: 'DELETE',
    url: `/admin/documents/${doc.id}`,
    headers: { cookie: env.cookies.operations },
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual((await env.app.inject({ method: 'GET', url: '/documents' })).json().documents, []);
  assert.equal((await env.app.inject({ method: 'GET', url: `/documents/${doc.id}/download` })).statusCode, 404);
});

test('disk storage keeps files inside its folder', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eqowa-docs-'));
  try {
    const disk = new DiskStorage(dir);
    await disk.put('documents/a/b.pdf', PDF);
    assert.deepEqual(await disk.get('documents/a/b.pdf'), PDF);
    assert.equal(await disk.get('documents/missing.pdf'), null);
    await assert.rejects(disk.put('../escape.pdf', PDF), /outside the documents folder/);
    await disk.delete('documents/a/b.pdf');
    assert.equal(await disk.get('documents/a/b.pdf'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
