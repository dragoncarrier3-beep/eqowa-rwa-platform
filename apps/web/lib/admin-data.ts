import type {
  AdminComplianceResponse,
  AdminDashboardResponse,
  AdminInvestorsResponse,
  AdminQuotesResponse,
  CompliancePrepareResponse,
  FreezeResponse,
  TokenActionResponse,
} from '@config/api';

import { AdminError } from '@/lib/admin';
import { load } from '@/lib/portfolio';
import { proxied } from '@/lib/siwe';

export type AdminException = {
  id: string;
  kind: string;
  intentId: string | null;
  status: 'open' | 'resolved';
  details: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
};

export type AuditRow = {
  id: string | number;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const fetchDashboard = () => load<AdminDashboardResponse>('/admin/dashboard');
export const fetchAdminQuotes = (status?: string) =>
  load<AdminQuotesResponse>(status ? `/admin/quotes?status=${encodeURIComponent(status)}` : '/admin/quotes');
export const fetchInvestors = () => load<AdminInvestorsResponse>('/admin/investors');
export const fetchExceptions = (status: 'open' | 'resolved') =>
  load<{ ok: true; exceptions: AdminException[] }>(`/admin/exceptions?status=${status}`);
export const fetchAudit = (limit = 200) => load<{ ok: true; audit: AuditRow[] }>(`/admin/audit?limit=${limit}`);

async function post<T>(route: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(proxied(route), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AdminError('api_unreachable');
  }
  const json = (await response.json().catch(() => ({ ok: false, reason: 'api_unreachable' }))) as
    (T & { ok: true }) | { ok: false; reason: string; detail?: string };
  if (!json.ok) {
    throw new AdminError(json.reason, json.detail);
  }
  return json;
}

export const setFrozen = (wallet: string, frozen: boolean, reason: string) =>
  post<FreezeResponse>(`/admin/investors/${wallet}/${frozen ? 'freeze' : 'unfreeze'}`, { reason });
export const resolveException = (id: string, resolution: string) =>
  post(`/admin/exceptions/${encodeURIComponent(id)}/resolve`, { resolution });
/** Records that the Safe signers executed the approval; the worker then mints. */
export const approveSafeMint = (intentId: string, safeTxHash: string) =>
  post(`/admin/mint/${encodeURIComponent(intentId)}/approve`, { safeTxHash });

export const SAFE_TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const EXCEPTION_TEXT: Record<string, string> = {
  remainder: 'Paid more than whole shares; the extra USDT needs a refund',
  amount_mismatch: 'Paid a different amount than quoted',
  late_deposit: 'Paid after the 15-minute quote expired',
  expired: 'Paid after the 15-minute quote expired',
  kyc_not_approved: 'Paid without approved KYC',
  unknown_intent: 'Payment reference not recognised',
  wrong_token: 'Escrow reported a token other than USDT',
  mint_failed: 'Mint transaction failed',
};

export function exceptionText(kind: string): string {
  return EXCEPTION_TEXT[kind] ?? kind.replaceAll('_', ' ');
}

export const fetchCompliance = () => load<AdminComplianceResponse>('/admin/compliance');
export const fetchCountries = (codes: number[]) =>
  load<{ ok: true; countries: Array<{ code: number; allowed: boolean }> }>(
    `/admin/compliance/countries?codes=${codes.join(',')}`,
  );

export type TokenAction = 'pause' | 'unpause' | 'mint' | 'burn';
export const runTokenAction = (action: TokenAction, body: { reason: string; wallet?: string; shares?: string }) =>
  post<TokenActionResponse>(`/admin/token/${action}`, body);

export type ComplianceChangeInput =
  | { kind: 'maxBalance' | 'maxHolderCount' | 'dailyMintCap' | 'lockupDays'; value: string }
  | { kind: 'allowCountries' | 'disallowCountries'; countries: number[] };
export const prepareCompliance = (change: ComplianceChangeInput) =>
  post<CompliancePrepareResponse>('/admin/compliance/prepare', change);

export type RecoveryTicketDto = {
  id: string;
  admin: { id: string; email: string; name: string; role: string } | null;
  requestedBy: string;
  reason: string;
  status: 'open' | 'approved' | 'rejected';
  safeTxHash: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export const fetchRecoveries = () => load<{ ok: true; tickets: RecoveryTicketDto[] }>('/admin/recovery');
export const openRecovery = (adminId: string, reason: string) =>
  post<{ ticket: RecoveryTicketDto }>('/admin/recovery', { adminId, reason });
export const approveRecovery = (id: string, safeTxHash: string) =>
  post<{ ticket: RecoveryTicketDto; inviteUrl: string; expiresAt: string }>(
    `/admin/recovery/${encodeURIComponent(id)}/approve`,
    { safeTxHash },
  );
export const rejectRecovery = (id: string, reason: string) =>
  post<{ ticket: RecoveryTicketDto }>(`/admin/recovery/${encodeURIComponent(id)}/reject`, { reason });
