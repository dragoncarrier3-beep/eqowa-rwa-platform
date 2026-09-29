import type { InvestorQuoteDto, PortfolioResponse } from '@config/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { ConfirmationBar } from '@/components/confirmation-bar';
import { PortfolioView } from '@/components/portfolio-view';
import { availableToTransfer, countdownText, unlockText } from '@/lib/portfolio';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const SHARE = 1_000_000n;

const PORTFOLIO: PortfolioResponse = {
  ok: true,
  walletAddress: '0x1111111111111111111111111111111111111111',
  tokenAddress: '0x2222222222222222222222222222222222222222',
  chainId: 80002,
  blockNumber: 48_211,
  readAt: NOW.toISOString(),
  balance: (30n * SHARE).toString(),
  frozen: false,
  frozenTokens: '0',
  identityAddress: '0x6666666666666666666666666666666666666666',
  lockup: {
    locked: (20n * SHARE).toString(),
    spendable: (10n * SHARE).toString(),
    lockupDays: 730,
    tranches: [{ amount: (20n * SHARE).toString(), releaseAt: '2028-09-20T00:00:00.000Z' }],
  },
};

function quote(overrides: Partial<InvestorQuoteDto>): InvestorQuoteDto {
  return {
    intentId: '0xintent',
    status: 'quoted',
    usdtAmount: '10000000',
    fundsAmount: '8000000',
    feeAmount: '2000000',
    remainderAmount: '0',
    shares: '2',
    shareAmount: (2n * SHARE).toString(),
    quoteExpiresAt: '2026-09-29T12:14:00.000Z',
    rejectReason: null,
    deposit: null,
    confirmations: null,
    mintTxHash: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const route = routes[url];
      return route ? Response.json(route.body, { status: route.status ?? 200 }) : Response.json({}, { status: 404 });
    }),
  );
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PortfolioView now={NOW} />
    </QueryClientProvider>,
  );
}

describe('portfolio helpers', () => {
  it('limits what can move by freezes and the identity lock-up', () => {
    expect(availableToTransfer(PORTFOLIO)).toBe(10n * SHARE);
    expect(availableToTransfer({ ...PORTFOLIO, lockup: null, frozenTokens: (4n * SHARE).toString() })).toBe(
      26n * SHARE,
    );
    expect(availableToTransfer({ ...PORTFOLIO, frozen: true })).toBe(0n);
  });

  it('describes unlock dates and countdowns', () => {
    expect(unlockText('2028-09-20T00:00:00.000Z', NOW)).toBe('in 722 days');
    expect(unlockText('2026-09-30T06:00:00.000Z', NOW)).toBe('tomorrow');
    expect(unlockText('2026-09-01T00:00:00.000Z', NOW)).toBe('unlocked');
    expect(countdownText('2026-09-29T12:14:05.000Z', NOW)).toBe('14:05');
    expect(countdownText('2026-09-29T14:03:00.000Z', NOW)).toBe('2h 03m');
    expect(countdownText('2026-09-29T11:00:00.000Z', NOW)).toBe('00:00');
  });

  it('draws confirmations capped at the requirement', () => {
    render(<ConfirmationBar current={15} required={12} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
  });
});

describe('PortfolioView', () => {
  // Countdowns read the clock; pin it so fixed quote times stay in the future.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks a signed-out visitor to sign in', async () => {
    stubApi({
      '/api/investor/portfolio': { status: 401, body: { ok: false, reason: 'unauthenticated' } },
      '/api/investor/quotes': { status: 401, body: { ok: false, reason: 'unauthenticated' } },
    });
    renderView();
    expect(await screen.findByText('Sign in to see your portfolio')).toBeTruthy();
  });

  it('shows holdings, the unlock schedule and each purchase with its progress', async () => {
    stubApi({
      '/api/investor/portfolio': { body: PORTFOLIO },
      '/api/investor/quotes': {
        body: {
          ok: true,
          currentBlock: 500,
          quotes: [
            quote({ intentId: '0xa', status: 'quoted' }),
            quote({
              intentId: '0xb',
              status: 'deposited',
              deposit: { txHash: '0xdeposit', blockNumber: 493, amount: '10000000' },
              confirmations: { current: 7, required: 12 },
            }),
            quote({ intentId: '0xc', status: 'minted', mintTxHash: '0xminted', remainderAmount: '3000000' }),
          ],
        },
      },
    });
    renderView();

    expect(await screen.findByText('Unlock schedule')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('in 722 days')).toBeTruthy();
    expect(screen.getByText('Pay within')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7');
    expect(screen.getByText('Minted')).toBeTruthy();
    expect(screen.getByText('Mint transaction').closest('a')).toHaveAttribute(
      'href',
      'https://amoy.polygonscan.com/tx/0xminted',
    );
    expect(screen.getByText(/3 USDT to refund/)).toBeTruthy();
  });

  it('keeps purchases visible when the chain cannot be read', async () => {
    stubApi({
      '/api/investor/portfolio': { status: 503, body: { ok: false, reason: 'chain_unavailable' } },
      '/api/investor/quotes': { body: { ok: true, currentBlock: null, quotes: [] } },
    });
    renderView();
    expect(await screen.findByText('Holdings unavailable')).toBeTruthy();
    expect(screen.getByText(/could not be read just now/)).toBeTruthy();
    expect(screen.getByText('No purchases yet.')).toBeTruthy();
  });

  it('warns when the wallet is frozen', async () => {
    stubApi({
      '/api/investor/portfolio': { body: { ...PORTFOLIO, frozen: true } },
      '/api/investor/quotes': { body: { ok: true, currentBlock: 1, quotes: [] } },
    });
    renderView();
    expect(await screen.findByRole('alert')).toHaveTextContent('This wallet is frozen');
  });
});
