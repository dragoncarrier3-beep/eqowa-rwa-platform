import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { AdminRole } from '../../../../config/adminRoles.ts';

/** invited: account exists, no key yet. active: can sign in. disabled: blocked by operations. */
export type AdminStatus = 'invited' | 'active' | 'disabled';

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: AdminStatus;
  createdAt: Date;
};

/** One enrolled authenticator: a YubiKey, or a platform passkey while testing. */
export type AdminCredential = {
  /** WebAuthn credential id, base64url. */
  id: string;
  adminId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type AdminInvite = {
  /** sha256 of the token; the token itself is only ever shown once, in the invite link. */
  tokenHash: string;
  adminId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdBy: string;
};

export interface AdminStore {
  createAdmin(input: { email: string; name: string; role: AdminRole; now: Date }): Promise<AdminUser>;
  getAdmin(id: string): Promise<AdminUser | undefined>;
  getAdminByEmail(email: string): Promise<AdminUser | undefined>;
  listAdmins(): Promise<AdminUser[]>;
  setStatus(id: string, status: AdminStatus): Promise<void>;
  createInvite(invite: AdminInvite): Promise<void>;
  /** An unexpired, unused invite, or undefined. */
  findInvite(tokenHash: string, now: Date): Promise<AdminInvite | undefined>;
  /** True exactly once for a valid invite. */
  consumeInvite(tokenHash: string, now: Date): Promise<boolean>;
  addCredential(credential: AdminCredential): Promise<void>;
  listCredentials(adminId: string): Promise<AdminCredential[]>;
  getCredential(id: string): Promise<AdminCredential | undefined>;
  recordUse(id: string, counter: number, now: Date): Promise<void>;
  removeCredential(id: string): Promise<void>;
}

const normalEmail = (email: string) => email.trim().toLowerCase();

export class MemoryAdminStore implements AdminStore {
  readonly admins: AdminUser[] = [];
  readonly invites: AdminInvite[] = [];
  readonly credentials: AdminCredential[] = [];

  async createAdmin(input: { email: string; name: string; role: AdminRole; now: Date }) {
    if (this.admins.some((admin) => admin.email === normalEmail(input.email))) {
      throw new Error('admin_exists');
    }
    const admin: AdminUser = {
      id: randomUUID(),
      email: normalEmail(input.email),
      name: input.name,
      role: input.role,
      status: 'invited',
      createdAt: input.now,
    };
    this.admins.push(admin);
    return { ...admin };
  }

  async getAdmin(id: string) {
    const admin = this.admins.find((item) => item.id === id);
    return admin ? { ...admin } : undefined;
  }

  async getAdminByEmail(email: string) {
    const admin = this.admins.find((item) => item.email === normalEmail(email));
    return admin ? { ...admin } : undefined;
  }

  async listAdmins() {
    return this.admins.map((admin) => ({ ...admin }));
  }

  async setStatus(id: string, status: AdminStatus) {
    const admin = this.admins.find((item) => item.id === id);
    if (admin) {
      admin.status = status;
    }
  }

  async createInvite(invite: AdminInvite) {
    this.invites.push({ ...invite });
  }

  async findInvite(tokenHash: string, now: Date) {
    const invite = this.invites.find((item) => item.tokenHash === tokenHash);
    return invite && !invite.consumedAt && invite.expiresAt > now ? { ...invite } : undefined;
  }

  async consumeInvite(tokenHash: string, now: Date) {
    const invite = this.invites.find((item) => item.tokenHash === tokenHash);
    if (!invite || invite.consumedAt || invite.expiresAt <= now) {
      return false;
    }
    invite.consumedAt = now;
    return true;
  }

  async addCredential(credential: AdminCredential) {
    this.credentials.push({ ...credential, transports: [...credential.transports] });
  }

  async listCredentials(adminId: string) {
    return this.credentials.filter((item) => item.adminId === adminId).map((item) => ({ ...item }));
  }

  async getCredential(id: string) {
    const credential = this.credentials.find((item) => item.id === id);
    return credential ? { ...credential } : undefined;
  }

  async recordUse(id: string, counter: number, now: Date) {
    const credential = this.credentials.find((item) => item.id === id);
    if (credential) {
      credential.counter = counter;
      credential.lastUsedAt = now;
    }
  }

  async removeCredential(id: string) {
    const index = this.credentials.findIndex((item) => item.id === id);
    if (index >= 0) {
      this.credentials.splice(index, 1);
    }
  }
}

type AdminRow = { id: string; email: string; name: string; role: AdminRole; status: AdminStatus; created_at: Date };
type CredentialRow = {
  credential_id: string;
  admin_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[] | null;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
};

const toAdmin = (row: AdminRow): AdminUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  status: row.status,
  createdAt: row.created_at,
});

const toCredential = (row: CredentialRow): AdminCredential => ({
  id: row.credential_id,
  adminId: row.admin_id,
  publicKey: new Uint8Array(row.public_key),
  counter: Number(row.counter),
  transports: row.transports ?? [],
  label: row.label,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

const ADMIN_COLUMNS = 'id, email, name, role, status, created_at';
const CREDENTIAL_COLUMNS = 'credential_id, admin_id, public_key, counter, transports, label, created_at, last_used_at';

export class PgAdminStore implements AdminStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async createAdmin(input: { email: string; name: string; role: AdminRole; now: Date }) {
    const result = await this.client.query<AdminRow>(
      `INSERT INTO admin_users (email, name, role, status, created_at)
       VALUES ($1, $2, $3, 'invited', $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${ADMIN_COLUMNS}`,
      [normalEmail(input.email), input.name, input.role, input.now],
    );
    if (!result.rows[0]) {
      throw new Error('admin_exists');
    }
    return toAdmin(result.rows[0]);
  }

  async getAdmin(id: string) {
    const result = await this.client.query<AdminRow>(`SELECT ${ADMIN_COLUMNS} FROM admin_users WHERE id = $1`, [id]);
    return result.rows[0] ? toAdmin(result.rows[0]) : undefined;
  }

  async getAdminByEmail(email: string) {
    const result = await this.client.query<AdminRow>(`SELECT ${ADMIN_COLUMNS} FROM admin_users WHERE email = $1`, [
      normalEmail(email),
    ]);
    return result.rows[0] ? toAdmin(result.rows[0]) : undefined;
  }

  async listAdmins() {
    const result = await this.client.query<AdminRow>(`SELECT ${ADMIN_COLUMNS} FROM admin_users ORDER BY created_at`);
    return result.rows.map(toAdmin);
  }

  async setStatus(id: string, status: AdminStatus) {
    await this.client.query(`UPDATE admin_users SET status = $2 WHERE id = $1`, [id, status]);
  }

  async createInvite(invite: AdminInvite) {
    await this.client.query(
      `INSERT INTO admin_invites (token_hash, admin_id, expires_at, created_by) VALUES ($1, $2, $3, $4)`,
      [invite.tokenHash, invite.adminId, invite.expiresAt, invite.createdBy],
    );
  }

  async findInvite(tokenHash: string, now: Date) {
    const result = await this.client.query<{
      token_hash: string;
      admin_id: string;
      expires_at: Date;
      consumed_at: Date | null;
      created_by: string;
    }>(
      `SELECT token_hash, admin_id, expires_at, consumed_at, created_by FROM admin_invites
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    return row
      ? {
          tokenHash: row.token_hash,
          adminId: row.admin_id,
          expiresAt: row.expires_at,
          consumedAt: row.consumed_at,
          createdBy: row.created_by,
        }
      : undefined;
  }

  async consumeInvite(tokenHash: string, now: Date) {
    // Check and use in one statement, so one link cannot enrol two keys by racing.
    const result = await this.client.query(
      `UPDATE admin_invites SET consumed_at = $2
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2`,
      [tokenHash, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addCredential(credential: AdminCredential) {
    await this.client.query(
      `INSERT INTO admin_credentials (credential_id, admin_id, public_key, counter, transports, label, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        credential.id,
        credential.adminId,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports,
        credential.label,
        credential.createdAt,
      ],
    );
  }

  async listCredentials(adminId: string) {
    const result = await this.client.query<CredentialRow>(
      `SELECT ${CREDENTIAL_COLUMNS} FROM admin_credentials WHERE admin_id = $1 ORDER BY created_at`,
      [adminId],
    );
    return result.rows.map(toCredential);
  }

  async getCredential(id: string) {
    const result = await this.client.query<CredentialRow>(
      `SELECT ${CREDENTIAL_COLUMNS} FROM admin_credentials WHERE credential_id = $1`,
      [id],
    );
    return result.rows[0] ? toCredential(result.rows[0]) : undefined;
  }

  async recordUse(id: string, counter: number, now: Date) {
    await this.client.query(`UPDATE admin_credentials SET counter = $2, last_used_at = $3 WHERE credential_id = $1`, [
      id,
      counter,
      now,
    ]);
  }

  async removeCredential(id: string) {
    await this.client.query(`DELETE FROM admin_credentials WHERE credential_id = $1`, [id]);
  }
}
