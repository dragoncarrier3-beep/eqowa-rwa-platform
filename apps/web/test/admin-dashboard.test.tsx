import type { AdminDashboardResponse, AdminMeResponse } from '@config/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AdminAudit } from '@/components/admin/admin-audit';
import { AdminExceptions } from '@/components/admin/admin-exceptions';
import { AdminInvestors } from '@/components/admin/admin-investors';
import { AdminOverview } from '@/components/admin/admin-overview';
import { AdminPurchases } from '@/components/admin/admin-purchases';
import { AdminShell } from '@/components/admin/admin-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const WALLET = '0x1111111111111111111111111111111111111111';
const INTENT = `0x${'ab'.repeat(32)}`;
const SAFE_TX = `0x${'cd'.repeat(32)}`;

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

function me(role: 'ceo' | 'compliance' | 'operations', permissions: string[], needsSecondKey = false): AdminMeResponse {
  return {
    ok: true,
    admin: { id: 'a', email: `${role}@eqowa.com`, name: role, role, status: 'active' },
    permissions,
    credentials: [],
    needsSecondKey,
  };
}

describe('AdminShell', () => {
  it('only lists the sections the role may open, and warns about a missing second key', async () => {
    stubApi({ '/api/auth/admin/me': { body: me('compliance', ['dashboard:view', 'investors:view'], true) } });
    renderWith(<AdminShell>{() => <p>content</p>}</AdminShell>);

    const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toEqual(['Overview', 'Investors', 'Exceptions', 'My keys']);
    expect(screen.getByRole('alert')).toHaveTextContent('Add your second key');
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('asks a signed-out visitor to sign in', async () => {
    stubApi({ '/api/auth/admin/me': { status: 401, body: { ok: false, reason: 'unauthenticated' } } });
    renderWith(<AdminShell>{() => <p>secret</p>}</AdminShell>);
    expect(await screen.findByRole('link', { name: 'Go to admin sign-in' })).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
  });
});

describe('AdminOverview', () => {
  it('leads with Safe approvals, exceptions and failed registrations', async () => {
    const dashboard: AdminDashboardResponse = {
      ok: true,
      quotes: {
        total: 9,
        byStatus: {
          quoted: 1,
          deposited: 1,
          awaiting_confirmations: 1,
          awaiting_safe_approval: 2,
          safe_approved: 0,
          minting: 0,
          minted: 3,
          expired: 1,
          rejected: 0,
        },
      },
      awaitingSafeApproval: 2,
      openExceptions: 4,
      kyc: { total: 6, approved: 5, pending: 1, rejected: 0, blockedCountry: 0, registered: 4, registrationFailed: 1 },
      holders: { holderWallets: 3, frozenWallets: 1, totalSupply: '1250000000', indexedBlock: 48_000 },
    };
    stubApi({ '/api/admin/dashboard': { body: dashboard } });
    renderWith(<AdminOverview />);

    expect(await screen.findByText('Waiting for Safe approval')).toBeTruthy();
    expect(screen.getByText('Waiting for Safe approval').closest('a')).toHaveAttribute(
      'href',
      '/admin/purchases?status=awaiting_safe_approval',
    );
    expect(screen.getByText('1,250')).toBeTruthy();
    expect(screen.getByText('Indexed to block 48,000')).toBeTruthy();
  });
});

describe('AdminPurchases', () => {
  const quote = {
    intentId: INTENT,
    wallet: WALLET,
    status: 'awaiting_safe_approval',
    usdtAmount: '100000000000',
    fundsAmount: '80000000000',
    feeAmount: '20000000000',
    remainderAmount: '0',
    shares: '20000',
    shareAmount: '20000000000',
    quoteExpiresAt: '2026-09-30T10:15:00.000Z',
    rejectReason: null,
    deposit: { txHash: '0xdep', blockNumber: 100, amount: '100000000000' },
    confirmations: { current: 12, required: 12 },
    mintTxHash: null,
  };

  it('records the Safe approval of a 100k purchase with a valid Safe transaction hash', async () => {
    const calls = stubApi({
      'GET /api/admin/quotes': { body: { ok: true, currentBlock: 120, quotes: [quote] } },
      [`POST /api/admin/mint/${INTENT}/approve`]: { body: { ok: true, quote: {} } },
    });
    renderWith(<AdminPurchases canApprove />);

    const input = await screen.findByLabelText(`Safe transaction hash for ${INTENT}`);
    const button = screen.getByRole('button', { name: 'Record approval' });
    fireEvent.change(input, { target: { value: '0x123' } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: SAFE_TX } });
    fireEvent.click(button);

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ safeTxHash: SAFE_TX });
  });

  it('shows no approval form to roles without mint:approve', async () => {
    stubApi({ 'GET /api/admin/quotes': { body: { ok: true, currentBlock: 120, quotes: [quote] } } });
    renderWith(<AdminPurchases canApprove={false} />);
    expect(await screen.findByText('Held for Safe approval')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record approval' })).toBeNull();
  });
});

describe('AdminInvestors', () => {
  const investors = {
    ok: true,
    investors: [
      {
        walletAddress: WALLET,
        kycStatus: 'approved',
        countryCode: 566,
        registration: 'registered',
        identityAddress: '0x9',
        registrationError: null,
        balance: '30000000',
        frozen: false,
        updatedBlock: 100,
      },
      {
        walletAddress: '0x3333333333333333333333333333333333333333',
        kycStatus: 'approved',
        countryCode: 288,
        registration: 'failed',
        identityAddress: null,
        registrationError: 'rpc down',
        balance: '0',
        frozen: false,
        updatedBlock: null,
      },
    ],
  };

  it('freezes only after a reason is given, and shows failed registrations', async () => {
    const calls = stubApi({
      'GET /api/admin/investors': { body: investors },
      [`POST /api/admin/investors/${WALLET}/freeze`]: { body: { ok: true, changed: true, txHash: '0xf' } },
    });
    renderWith(<AdminInvestors canFreeze />);

    expect(await screen.findByText('rpc down')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Freeze' })[0]);
    const confirm = screen.getByRole('button', { name: 'Confirm freeze' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`Reason to freeze ${WALLET}`), { target: { value: 'Court order' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ reason: 'Court order' });
  });

  it('hides freeze from roles without investors:freeze', async () => {
    stubApi({ 'GET /api/admin/investors': { body: investors } });
    renderWith(<AdminInvestors canFreeze={false} />);
    expect(await screen.findByText('rpc down')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Freeze' })).toBeNull();
  });
});

describe('AdminExceptions and AdminAudit', () => {
  it('resolves an open exception with a note', async () => {
    const calls = stubApi({
      'GET /api/admin/exceptions?status=open': {
        body: {
          ok: true,
          exceptions: [
            {
              id: 'ex-1',
              kind: 'remainder',
              intentId: INTENT,
              status: 'open',
              details: {},
              createdAt: '2026-09-30T09:00:00.000Z',
              resolvedAt: null,
              resolvedBy: null,
              resolution: null,
            },
          ],
        },
      },
      'POST /api/admin/exceptions/ex-1/resolve': { body: { ok: true } },
    });
    renderWith(<AdminExceptions canResolve />);

    expect(await screen.findByText(/extra USDT needs a refund/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Resolution for ex-1'), { target: { value: 'Refunded 2 USDT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ resolution: 'Refunded 2 USDT' });
  });

  it('lists audit entries with who did what', async () => {
    stubApi({
      '/api/admin/audit?limit=200': {
        body: {
          ok: true,
          audit: [
            {
              id: 1,
              actor: 'legal@eqowa.com',
              action: 'investor.frozen',
              payload: { wallet: WALLET, reason: 'Court order' },
              createdAt: '2026-09-30T09:00:00.000Z',
            },
          ],
        },
      },
    });
    renderWith(<AdminAudit />);
    expect(await screen.findByText('investor.frozen')).toBeTruthy();
    expect(screen.getByText('legal@eqowa.com')).toBeTruthy();
    expect(screen.getByText(/Court order/)).toBeTruthy();
  });
});
