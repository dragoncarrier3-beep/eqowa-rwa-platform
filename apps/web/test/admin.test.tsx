import type { AdminMeResponse } from '@config/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AdminEnrol } from '@/components/admin/admin-enrol';
import { AdminHome } from '@/components/admin/admin-home';
import { AdminLogin } from '@/components/admin/admin-login';
import { AdminTeam } from '@/components/admin/admin-team';
import { AdminError, adminErrorText } from '@/lib/admin';

const browser = vi.hoisted(() => ({
  startRegistration: vi.fn(async () => ({ id: 'new-key', type: 'public-key', response: {} })),
  startAuthentication: vi.fn(async () => ({ id: 'key-1', type: 'public-key', response: {} })),
}));
vi.mock('@simplewebauthn/browser', () => browser);

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

const LARRY = {
  id: 'a1',
  email: 'larryjacob@eqowa.com',
  name: 'Larry Jacob',
  role: 'operations' as const,
  status: 'active' as const,
};

function me(overrides: Partial<AdminMeResponse> = {}): AdminMeResponse {
  return {
    ok: true,
    admin: LARRY,
    permissions: ['dashboard:view', 'team:view', 'team:manage'],
    credentials: [{ id: 'key-1', label: 'YubiKey 1', createdAt: '2026-09-30T09:00:00.000Z', lastUsedAt: null }],
    needsSecondKey: true,
    ...overrides,
  };
}

type Call = { url: string; method: string; body: unknown };

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const route = routes[`${init?.method ?? 'GET'} ${url}`] ?? routes[url];
      return route ? Response.json(route.body, { status: route.status ?? 200 }) : Response.json({}, { status: 404 });
    }),
  );
  return calls;
}

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  navigation.push.mockClear();
  browser.startRegistration.mockClear();
  browser.startAuthentication.mockClear();
});

describe('AdminLogin', () => {
  it('signs in with the key for the email and opens the admin area', async () => {
    const calls = stubApi({
      '/api/auth/admin/login/options': { body: { ok: true, options: { challenge: 'c1' } } },
      '/api/auth/admin/login/verify': { body: { ok: true, admin: LARRY } },
    });
    renderWith(<AdminLogin />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'larryjacob@eqowa.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with security key' }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/admin'));
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c1' } });
    expect(calls[1].body).toEqual({
      email: 'larryjacob@eqowa.com',
      response: { id: 'key-1', type: 'public-key', response: {} },
    });
  });

  it('explains a refused sign-in', async () => {
    stubApi({
      '/api/auth/admin/login/options': { body: { ok: true, options: { challenge: 'c1' } } },
      '/api/auth/admin/login/verify': { status: 401, body: { ok: false, reason: 'invalid_login' } },
    });
    renderWith(<AdminLogin />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@eqowa.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with security key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed');
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe('AdminEnrol', () => {
  it('shows who is being enrolled and registers the first key with the invite token', async () => {
    const calls = stubApi({
      '/api/auth/admin/invite/inspect': { body: { ok: true, admin: LARRY, expiresAt: '2026-10-03T09:00:00.000Z' } },
      '/api/auth/admin/register/options': { body: { ok: true, options: { challenge: 'r1' } } },
      '/api/auth/admin/register/verify': { body: { ok: true } },
    });
    renderWith(<AdminEnrol token="tok-123" />);

    expect(await screen.findByText(/You are joining as Technical and Operations/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Register security key' }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/admin'));
    const verify = calls.find((call) => call.url === '/api/auth/admin/register/verify')!;
    expect(verify.body).toMatchObject({ token: 'tok-123', label: 'YubiKey 1' });
  });

  it('explains a used or expired invite', async () => {
    stubApi({ '/api/auth/admin/invite/inspect': { status: 404, body: { ok: false, reason: 'invalid_invite' } } });
    renderWith(<AdminEnrol token="old" />);
    expect(await screen.findByText('Invite link not valid')).toBeTruthy();
  });
});

describe('AdminHome', () => {
  it('asks for a second key and keeps the only key from being removed', async () => {
    stubApi({ '/api/auth/admin/me': { body: me() } });
    renderWith(<AdminHome />);

    expect(await screen.findByText('Add your second key.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove YubiKey 1' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/admin/team');
  });

  it('adds a second key from the session', async () => {
    const calls = stubApi({
      '/api/auth/admin/me': { body: me() },
      '/api/auth/admin/register/options': { body: { ok: true, options: { challenge: 'r2' } } },
      '/api/auth/admin/register/verify': { body: { ok: true } },
    });
    renderWith(<AdminHome />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a key' }));
    await waitFor(() => expect(browser.startRegistration).toHaveBeenCalledOnce());
    const verify = calls.find((call) => call.url === '/api/auth/admin/register/verify')!;
    // No token: the session identifies the admin.
    expect(verify.body).toMatchObject({ label: 'YubiKey 2' });
    expect((verify.body as { token?: string }).token).toBeUndefined();
  });

  it('has no banner with two keys, and sends a signed-out visitor to sign-in', async () => {
    stubApi({
      '/api/auth/admin/me': {
        body: me({
          needsSecondKey: false,
          credentials: [
            { id: 'k1', label: 'YubiKey 1', createdAt: '2026-09-30T09:00:00.000Z', lastUsedAt: null },
            { id: 'k2', label: 'YubiKey 2', createdAt: '2026-09-30T09:05:00.000Z', lastUsedAt: null },
          ],
        }),
      },
    });
    const first = renderWith(<AdminHome />);
    expect(await screen.findByText('Security keys')).toBeTruthy();
    expect(screen.queryByText('Add your second key.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove YubiKey 1' })).toBeEnabled();
    first.unmount();

    stubApi({ '/api/auth/admin/me': { status: 401, body: { ok: false, reason: 'unauthenticated' } } });
    renderWith(<AdminHome />);
    expect(await screen.findByRole('link', { name: 'Go to admin sign-in' })).toHaveAttribute('href', '/admin/login');
  });
});

describe('AdminTeam', () => {
  const TEAM = {
    ok: true,
    team: [
      { ...LARRY, credentialCount: 2 },
      {
        id: 'a2',
        email: 'legal@eqowa.com',
        name: 'Compliance',
        role: 'compliance',
        status: 'invited',
        credentialCount: 0,
      },
    ],
  };

  it('lists the team and shows a new invite link once', async () => {
    const calls = stubApi({
      '/api/auth/admin/me': { body: me() },
      'GET /api/admin/team': { body: TEAM },
      'POST /api/admin/team/invite': {
        body: {
          ok: true,
          admin: { id: 'a3', email: 'info@eqowa.com', name: 'Peter', role: 'ceo', status: 'invited' },
          inviteUrl: 'https://app.eqowa.com/admin/enrol?token=abc',
          expiresAt: '2026-10-03T09:00:00.000Z',
        },
      },
    });
    renderWith(<AdminTeam />);

    expect(await screen.findByText('legal@eqowa.com')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'info@eqowa.com' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Peter' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ceo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    expect(await screen.findByLabelText('Invite link')).toHaveTextContent(
      'https://app.eqowa.com/admin/enrol?token=abc',
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      email: 'info@eqowa.com',
      name: 'Peter',
      role: 'ceo',
    });
  });

  it('hides the invite form from roles without team:manage', async () => {
    stubApi({
      '/api/auth/admin/me': { body: me({ admin: { ...LARRY, role: 'ceo' }, permissions: ['team:view'] }) },
      'GET /api/admin/team': { body: TEAM },
    });
    renderWith(<AdminTeam />);
    expect(await screen.findByText('legal@eqowa.com')).toBeTruthy();
    expect(screen.queryByText('Invite an admin')).toBeNull();
  });
});

describe('adminErrorText', () => {
  it('turns API reasons and browser key errors into plain sentences', () => {
    expect(adminErrorText(new AdminError('last_credential'))).toMatch(/only key/);
    const closed = Object.assign(new Error('The operation either timed out or was not allowed.'), {
      name: 'NotAllowedError',
    });
    expect(adminErrorText(closed)).toMatch(/closed or timed out/);
    const duplicate = Object.assign(new Error('x'), { name: 'InvalidStateError' });
    expect(adminErrorText(duplicate)).toMatch(/already registered/);
  });
});
