/**
 * Admin roles and what each may do, agreed with Eqowa on 27 September 2026.
 * The API guards routes with `can`, the web app hides what a role cannot use.
 *
 * - ceo: view-only in the portal. High-value sign-off happens as a Safe signer.
 * - operations: full control, including 100k approvals, pause, compliance
 *   settings, documents and admin recovery.
 * - compliance: KYC review, freeze and unfreeze, the exception queue.
 */

export const ADMIN_ROLES = ['ceo', 'operations', 'compliance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  ceo: 'CEO (view only)',
  operations: 'Technical and Operations',
  compliance: 'Compliance Admin',
};

export const ADMIN_PERMISSIONS = [
  'dashboard:view',
  'quotes:view',
  'investors:view',
  'audit:view',
  'compliance:view',
  'documents:view',
  'team:view',
  'kyc:review',
  'investors:freeze',
  'exceptions:resolve',
  'mint:approve',
  'token:mint',
  'token:burn',
  'token:pause',
  'compliance:prepare',
  'documents:manage',
  'team:manage',
  'recovery:request',
  'recovery:approve',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const VIEW = ADMIN_PERMISSIONS.filter((permission) => permission.endsWith(':view'));

export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  // Any admin can open a recovery ticket for a lost key; only operations approves.
  ceo: [...VIEW, 'recovery:request'],
  operations: ADMIN_PERMISSIONS,
  compliance: [...VIEW, 'kyc:review', 'investors:freeze', 'exceptions:resolve', 'recovery:request'],
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function can(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
