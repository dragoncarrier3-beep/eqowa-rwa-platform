import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

import type { AdminMeResponse, ApiError, InviteInspectResponse, TeamInviteResponse, TeamResponse } from '@config/api';

import { load } from '@/lib/portfolio';
import { proxied } from '@/lib/siwe';

export const fetchAdminMe = () => load<AdminMeResponse>('/auth/admin/me');
export const fetchTeam = () => load<TeamResponse>('/admin/team');

export class AdminError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

async function post<T>(route: string, body: unknown, method = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(proxied(route), {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AdminError('api_unreachable');
  }
  const json = (await response.json().catch(() => ({ ok: false, reason: 'api_unreachable' }))) as
    (T & { ok: true }) | ApiError;
  if (!json.ok) {
    throw new AdminError(json.reason);
  }
  return json;
}

export const inspectInvite = (token: string) => post<InviteInspectResponse>('/auth/admin/invite/inspect', { token });

/**
 * Registers a security key: with an invite token for the first key, or with
 * the admin session for another one. The browser shows its own key prompt.
 */
export async function enrolKey(input: { token?: string; label: string }): Promise<void> {
  const { options } = await post<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
    '/auth/admin/register/options',
    { token: input.token },
  );
  const response = await startRegistration({ optionsJSON: options });
  await post('/auth/admin/register/verify', { token: input.token, label: input.label, response });
}

export async function signInWithKey(email: string): Promise<void> {
  const { options } = await post<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
    '/auth/admin/login/options',
    { email },
  );
  const response = await startAuthentication({ optionsJSON: options });
  await post('/auth/admin/login/verify', { email, response });
}

export const signOutAdmin = () => post('/auth/admin/logout', undefined);
export const removeKey = (id: string) => post(`/auth/admin/credentials/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const inviteMember = (input: { email: string; name: string; role: string }) =>
  post<TeamInviteResponse>('/admin/team/invite', input);

const REASON_TEXT: Record<string, string> = {
  invalid_invite: 'This invite link is invalid, used or expired. Ask for a new one.',
  invite_used: 'This invite link was already used. Ask for a new one.',
  invalid_response: 'The security key could not be registered. Please try again.',
  invalid_login: 'Sign-in failed. Check the email and use a key registered for it.',
  too_many_credentials: 'This account already has the maximum number of keys.',
  last_credential: 'This is your only key. Add another key before removing it.',
  admin_active: 'This person already has an active admin account.',
  invalid_email: 'Enter a valid email address.',
  invalid_role: 'Choose a role.',
  forbidden: 'Your role does not allow this.',
  admin_auth_unconfigured: 'Admin sign-in is not configured on this environment.',
  api_unreachable: 'The platform is not reachable. Please try again shortly.',
};

export function adminErrorText(error: unknown): string {
  if (error instanceof AdminError) {
    return REASON_TEXT[error.reason] ?? 'Something went wrong. Please try again.';
  }
  // The browser throws NotAllowedError when the key prompt is closed or times out.
  if (error instanceof Error && (error.name === 'NotAllowedError' || /not allowed|cancel/i.test(error.message))) {
    return 'The security key prompt was closed or timed out. Nothing was changed.';
  }
  if (error instanceof Error && error.name === 'InvalidStateError') {
    return 'This key is already registered for this account.';
  }
  return 'Something went wrong. Please try again.';
}
