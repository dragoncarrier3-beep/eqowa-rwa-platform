import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PoolClient } from 'pg';

/** public: anyone can download. kyc: signed-in investors with approved KYC only. */
export type DocumentVisibility = 'public' | 'kyc';

/** draft: record created, no file yet. ready: file uploaded and listed to investors. */
export type DocumentStatus = 'draft' | 'ready';

export type DocumentRecord = {
  id: string;
  title: string;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  filename: string | null;
  size: number | null;
  sha256: string | null;
  storageKey: string | null;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface DocumentStore {
  create(input: {
    title: string;
    visibility: DocumentVisibility;
    uploadedBy: string;
    now: Date;
  }): Promise<DocumentRecord>;
  get(id: string): Promise<DocumentRecord | undefined>;
  /** Not deleted, newest first. */
  list(): Promise<DocumentRecord[]>;
  update(id: string, patch: Partial<Pick<DocumentRecord, 'title' | 'visibility'>>, now: Date): Promise<void>;
  attachFile(
    id: string,
    file: { filename: string; size: number; sha256: string; storageKey: string; uploadedBy: string },
    now: Date,
  ): Promise<void>;
  /** Soft delete: the record stays for the audit trail, investors stop seeing it. */
  remove(id: string, now: Date): Promise<void>;
}

/** Where file bytes live. Disk by default; an S3 bucket in production. */
export interface FileStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A new key per upload: replacing a file never overwrites the bytes an old link points at. */
export function storageKeyFor(documentId: string): string {
  return `documents/${documentId}/${randomUUID()}.pdf`;
}

export class DiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    // Keys are generated here, but never let one escape the storage folder.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error('storage key outside the documents folder');
    }
    return full;
  }

  async put(key: string, bytes: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) {
    this.files.set(key, Buffer.from(bytes));
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

export class MemoryDocumentStore implements DocumentStore {
  readonly records: (DocumentRecord & { deletedAt: Date | null })[] = [];

  async create(input: { title: string; visibility: DocumentVisibility; uploadedBy: string; now: Date }) {
    const record = {
      id: randomUUID(),
      title: input.title,
      visibility: input.visibility,
      status: 'draft' as const,
      filename: null,
      size: null,
      sha256: null,
      storageKey: null,
      uploadedBy: input.uploadedBy,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    };
    this.records.push(record);
    const { deletedAt: _deleted, ...visible } = record;
    return { ...visible };
  }

  private live(id: string) {
    return this.records.find((item) => item.id === id && !item.deletedAt);
  }

  async get(id: string) {
    const record = this.live(id);
    if (!record) {
      return undefined;
    }
    const { deletedAt: _deleted, ...visible } = record;
    return { ...visible };
  }

  async list() {
    return this.records
      .filter((item) => !item.deletedAt)
      .slice()
      .reverse()
      .map(({ deletedAt: _deleted, ...visible }) => ({ ...visible }));
  }

  async update(id: string, patch: Partial<Pick<DocumentRecord, 'title' | 'visibility'>>, now: Date) {
    const record = this.live(id);
    if (record) {
      Object.assign(record, patch, { updatedAt: now });
    }
  }

  async attachFile(
    id: string,
    file: { filename: string; size: number; sha256: string; storageKey: string; uploadedBy: string },
    now: Date,
  ) {
    const record = this.live(id);
    if (record) {
      Object.assign(record, file, { status: 'ready', updatedAt: now });
    }
  }

  async remove(id: string, now: Date) {
    const record = this.live(id);
    if (record) {
      record.deletedAt = now;
    }
  }
}

type DocumentRow = {
  id: string;
  title: string;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  filename: string | null;
  size: string | null;
  sha256: string | null;
  storage_key: string | null;
  uploaded_by: string;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS =
  'id, title, visibility, status, filename, size, sha256, storage_key, uploaded_by, created_at, updated_at';

const toRecord = (row: DocumentRow): DocumentRecord => ({
  id: row.id,
  title: row.title,
  visibility: row.visibility,
  status: row.status,
  filename: row.filename,
  size: row.size === null ? null : Number(row.size),
  sha256: row.sha256,
  storageKey: row.storage_key,
  uploadedBy: row.uploaded_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class PgDocumentStore implements DocumentStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async create(input: { title: string; visibility: DocumentVisibility; uploadedBy: string; now: Date }) {
    const result = await this.client.query<DocumentRow>(
      `INSERT INTO documents (title, visibility, status, uploaded_by, created_at, updated_at)
       VALUES ($1, $2, 'draft', $3, $4, $4) RETURNING ${COLUMNS}`,
      [input.title, input.visibility, input.uploadedBy, input.now],
    );
    return toRecord(result.rows[0]!);
  }

  async get(id: string) {
    const result = await this.client.query<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async list() {
    const result = await this.client.query<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return result.rows.map(toRecord);
  }

  async update(id: string, patch: Partial<Pick<DocumentRecord, 'title' | 'visibility'>>, now: Date) {
    await this.client.query(
      `UPDATE documents SET title = COALESCE($2, title), visibility = COALESCE($3, visibility), updated_at = $4
       WHERE id = $1 AND deleted_at IS NULL`,
      [id, patch.title ?? null, patch.visibility ?? null, now],
    );
  }

  async attachFile(
    id: string,
    file: { filename: string; size: number; sha256: string; storageKey: string; uploadedBy: string },
    now: Date,
  ) {
    await this.client.query(
      `UPDATE documents SET filename = $2, size = $3, sha256 = $4, storage_key = $5, uploaded_by = $6,
         status = 'ready', updated_at = $7
       WHERE id = $1 AND deleted_at IS NULL`,
      [id, file.filename, file.size, file.sha256, file.storageKey, file.uploadedBy, now],
    );
  }

  async remove(id: string, now: Date) {
    await this.client.query(`UPDATE documents SET deleted_at = $2 WHERE id = $1 AND deleted_at IS NULL`, [id, now]);
  }
}
