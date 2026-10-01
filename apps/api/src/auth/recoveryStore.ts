import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

export type RecoveryStatus = 'open' | 'approved' | 'rejected';

/** A request to reset the keys of an admin who lost them. */
export type RecoveryTicket = {
  id: string;
  adminId: string;
  requestedBy: string;
  reason: string;
  status: RecoveryStatus;
  safeTxHash: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export interface RecoveryStore {
  open(input: { adminId: string; requestedBy: string; reason: string; now: Date }): Promise<RecoveryTicket>;
  get(id: string): Promise<RecoveryTicket | undefined>;
  list(): Promise<RecoveryTicket[]>;
  /** An open ticket for the admin, if any: one at a time. */
  openFor(adminId: string): Promise<RecoveryTicket | undefined>;
  /** Closes an open ticket; false when it was not open any more. */
  resolve(
    id: string,
    input: {
      status: 'approved' | 'rejected';
      resolvedBy: string;
      safeTxHash: string | null;
      resolution: string;
      now: Date;
    },
  ): Promise<boolean>;
}

export class MemoryRecoveryStore implements RecoveryStore {
  readonly tickets: RecoveryTicket[] = [];

  async open(input: { adminId: string; requestedBy: string; reason: string; now: Date }) {
    const ticket: RecoveryTicket = {
      id: randomUUID(),
      adminId: input.adminId,
      requestedBy: input.requestedBy,
      reason: input.reason,
      status: 'open',
      safeTxHash: null,
      resolvedBy: null,
      resolution: null,
      createdAt: input.now,
      resolvedAt: null,
    };
    this.tickets.push(ticket);
    return { ...ticket };
  }

  async get(id: string) {
    const ticket = this.tickets.find((item) => item.id === id);
    return ticket ? { ...ticket } : undefined;
  }

  async list() {
    return this.tickets
      .slice()
      .reverse()
      .map((item) => ({ ...item }));
  }

  async openFor(adminId: string) {
    const ticket = this.tickets.find((item) => item.adminId === adminId && item.status === 'open');
    return ticket ? { ...ticket } : undefined;
  }

  async resolve(
    id: string,
    input: {
      status: 'approved' | 'rejected';
      resolvedBy: string;
      safeTxHash: string | null;
      resolution: string;
      now: Date;
    },
  ) {
    const ticket = this.tickets.find((item) => item.id === id);
    if (!ticket || ticket.status !== 'open') {
      return false;
    }
    Object.assign(ticket, {
      status: input.status,
      resolvedBy: input.resolvedBy,
      safeTxHash: input.safeTxHash,
      resolution: input.resolution,
      resolvedAt: input.now,
    });
    return true;
  }
}

type TicketRow = {
  id: string;
  admin_id: string;
  requested_by: string;
  reason: string;
  status: RecoveryStatus;
  safe_tx_hash: string | null;
  resolved_by: string | null;
  resolution: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

const COLUMNS =
  'id, admin_id, requested_by, reason, status, safe_tx_hash, resolved_by, resolution, created_at, resolved_at';

const toTicket = (row: TicketRow): RecoveryTicket => ({
  id: row.id,
  adminId: row.admin_id,
  requestedBy: row.requested_by,
  reason: row.reason,
  status: row.status,
  safeTxHash: row.safe_tx_hash,
  resolvedBy: row.resolved_by,
  resolution: row.resolution,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
});

export class PgRecoveryStore implements RecoveryStore {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async open(input: { adminId: string; requestedBy: string; reason: string; now: Date }) {
    const result = await this.client.query<TicketRow>(
      `INSERT INTO admin_recoveries (admin_id, requested_by, reason, status, created_at)
       VALUES ($1, $2, $3, 'open', $4) RETURNING ${COLUMNS}`,
      [input.adminId, input.requestedBy, input.reason, input.now],
    );
    return toTicket(result.rows[0]!);
  }

  async get(id: string) {
    const result = await this.client.query<TicketRow>(`SELECT ${COLUMNS} FROM admin_recoveries WHERE id = $1`, [id]);
    return result.rows[0] ? toTicket(result.rows[0]) : undefined;
  }

  async list() {
    const result = await this.client.query<TicketRow>(
      `SELECT ${COLUMNS} FROM admin_recoveries ORDER BY created_at DESC`,
    );
    return result.rows.map(toTicket);
  }

  async openFor(adminId: string) {
    const result = await this.client.query<TicketRow>(
      `SELECT ${COLUMNS} FROM admin_recoveries WHERE admin_id = $1 AND status = 'open' LIMIT 1`,
      [adminId],
    );
    return result.rows[0] ? toTicket(result.rows[0]) : undefined;
  }

  async resolve(
    id: string,
    input: {
      status: 'approved' | 'rejected';
      resolvedBy: string;
      safeTxHash: string | null;
      resolution: string;
      now: Date;
    },
  ) {
    // Only an open ticket closes, so two approvers racing cannot both reset keys.
    const result = await this.client.query(
      `UPDATE admin_recoveries
       SET status = $2, resolved_by = $3, safe_tx_hash = $4, resolution = $5, resolved_at = $6
       WHERE id = $1 AND status = 'open'`,
      [id, input.status, input.resolvedBy, input.safeTxHash, input.resolution, input.now],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
