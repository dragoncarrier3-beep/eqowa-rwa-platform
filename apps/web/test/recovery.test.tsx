import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AdminRecovery } from '@/components/admin/admin-recovery';

const SAFE_TX = `0x${'5a'.repeat(32)}`;
const TEAM = {
  ok: true,
  team: [
    { id: 'larry', email: 'larry@eqowa.com', name: 'Larry', role: 'operations', status: 'active', credentialCount: 2 },
    { id: 'legal', email: 'legal@eqowa.com', name: 'Legal', role: 'compliance', status: 'active', credentialCount: 2 },
  ],
};
const TICKET = {
  id: 't1',
  admin: { id: 'larry', email: 'larry@eqowa.com', name: 'Larry', role: 'operations' },
  requestedBy: 'legal@eqowa.com',
  reason: 'Both YubiKeys lost',
  status: 'open',
  safeTxHash: null,
  resolvedBy: null,
  resolution: null,
  createdAt: '2026-09-30T13:00:00.000Z',
  resolvedAt: null,
};

type Call = { url: string; method: string; body: unknown };

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const route = routes[`${method} ${url}`] ?? routes[url];
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
});

describe('AdminRecovery', () => {
  it('opens a recovery for the admin who lost access', async () => {
    const calls = stubApi({
      'GET /api/admin/recovery': { body: { ok: true, tickets: [] } },
      'GET /api/admin/team': { body: TEAM },
      'POST /api/admin/recovery': { body: { ok: true, ticket: TICKET } },
    });
    renderWith(<AdminRecovery canApprove={false} myAdminId="legal" />);

    await screen.findByRole('option', { name: 'Larry (larry@eqowa.com)' });
    fireEvent.change(screen.getByLabelText('Admin who lost access'), { target: { value: 'larry' } });
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Both YubiKeys lost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open recovery' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      adminId: 'larry',
      reason: 'Both YubiKeys lost',
    });
  });

  it('approves with a Safe hash and shows the new invite once', async () => {
    const calls = stubApi({
      'GET /api/admin/recovery': { body: { ok: true, tickets: [TICKET] } },
      'GET /api/admin/team': { body: TEAM },
      'POST /api/admin/recovery/t1/approve': {
        body: {
          ok: true,
          ticket: { ...TICKET, status: 'approved' },
          inviteUrl: 'https://app.eqowa.com/admin/enrol?token=new',
          expiresAt: '2026-10-03T13:00:00.000Z',
        },
      },
    });
    renderWith(<AdminRecovery canApprove myAdminId="someone-else" />);

    const approve = await screen.findByRole('button', { name: 'Approve and reset keys' });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Safe transaction hash for t1'), { target: { value: SAFE_TX } });
    fireEvent.click(approve);

    expect(await screen.findByLabelText('New invite link')).toHaveTextContent(
      'https://app.eqowa.com/admin/enrol?token=new',
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ safeTxHash: SAFE_TX });
  });

  it('never offers an admin the approval of their own reset', async () => {
    stubApi({
      'GET /api/admin/recovery': { body: { ok: true, tickets: [TICKET] } },
      'GET /api/admin/team': { body: TEAM },
    });
    renderWith(<AdminRecovery canApprove myAdminId="larry" />);
    expect(await screen.findByText(/Both YubiKeys lost/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and reset keys' })).toBeNull();
  });
});
