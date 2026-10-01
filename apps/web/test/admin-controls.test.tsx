import type { AdminComplianceResponse } from '@config/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AdminCompliance } from '@/components/admin/admin-compliance';
import { AdminControls } from '@/components/admin/admin-controls';

const WALLET = '0x1111111111111111111111111111111111111111';

const COMPLIANCE: AdminComplianceResponse = {
  ok: true,
  blockNumber: 900,
  compliance: '0x3333333333333333333333333333333333333333',
  safe: '0x9999999999999999999999999999999999999999',
  paused: false,
  rules: {
    maxBalanceShares: '150000',
    maxHolderCount: '500',
    holderCount: '12',
    dailyMintCapShares: '250000',
    remainingMintShares: '249000',
    lockupDays: '730',
  },
  countryModule: '0x8888888888888888888888888888888888888888',
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

describe('AdminCompliance', () => {
  it('shows the live rules and prepares a change as a downloadable Safe batch file', async () => {
    const file = {
      version: '1.0',
      chainId: '80002',
      transactions: [{ to: COMPLIANCE.compliance, value: '0', data: '0xab' }],
    };
    const calls = stubApi({
      'GET /api/admin/compliance': { body: COMPLIANCE },
      'POST /api/admin/compliance/prepare': {
        body: { ok: true, description: 'Set the per-investor holding limit to 200,000 shares', file },
      },
    });
    renderWith(<AdminCompliance canPrepare />);

    expect(await screen.findByText('150,000')).toBeTruthy();
    expect(screen.getByText('12 / 500')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Safe transaction' }));

    const link = await screen.findByRole('link', { name: /Download Safe batch file/ });
    expect(link).toHaveAttribute('download', 'eqowa-compliance-maxBalance.json');
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('"chainId": "80002"');
    expect(screen.getByText(/holding limit to 200,000 shares/)).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ kind: 'maxBalance', value: '200000' });
  });

  it('checks countries, and hides the change form without compliance:prepare', async () => {
    stubApi({
      'GET /api/admin/compliance': { body: COMPLIANCE },
      '/api/admin/compliance/countries?codes=566,840': {
        body: {
          ok: true,
          countries: [
            { code: 566, allowed: true },
            { code: 840, allowed: false },
          ],
        },
      },
    });
    renderWith(<AdminCompliance canPrepare={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check' }));
    expect(await screen.findByText('566: allowed')).toBeTruthy();
    expect(screen.getByText('840: blocked')).toBeTruthy();
    expect(screen.queryByText('Change a rule')).toBeNull();
  });
});

describe('AdminControls', () => {
  it('pauses trading with a reason', async () => {
    const calls = stubApi({
      'GET /api/admin/compliance': { body: COMPLIANCE },
      'POST /api/admin/token/pause': { body: { ok: true, changed: true, txHash: '0xpause' } },
    });
    renderWith(<AdminControls />);

    const button = await screen.findByRole('button', { name: 'Pause trading' });
    // Disabled until the current trading state is known, then until a reason is given.
    expect(button).toBeDisabled();
    expect(await screen.findByText('Active')).toBeTruthy();
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason to change trading'), { target: { value: 'Incident review' } });
    fireEvent.click(button);

    expect(await screen.findByRole('status')).toHaveTextContent('Trading paused.');
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ reason: 'Incident review' });
  });

  it("shows the chain's own reason when a mint is refused", async () => {
    stubApi({
      'GET /api/admin/compliance': { body: COMPLIANCE },
      'POST /api/admin/token/mint': {
        status: 502,
        body: {
          ok: false,
          reason: 'chain_error',
          detail: 'The receiving wallet has no verified identity. The investor must complete KYC first.',
        },
      },
    });
    renderWith(<AdminControls />);

    fireEvent.change(await screen.findByLabelText('Wallet to mint'), { target: { value: WALLET } });
    fireEvent.change(screen.getByLabelText('Shares to mint'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Reason to mint'), { target: { value: 'Allocation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mint shares' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no verified identity'));
  });
});
