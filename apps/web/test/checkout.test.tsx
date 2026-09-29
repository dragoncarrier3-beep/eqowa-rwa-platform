import type { CheckoutResponse } from '@config/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { CheckoutView } from '@/components/checkout-view';
import { PurchaseError, purchaseErrorText, runPurchase, type SignTypedData } from '@/lib/checkout';

const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const INTENT = `0x${'ab'.repeat(32)}`;

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: WALLET }),
  useSignTypedData: () => ({ signTypedDataAsync: async () => `0x${'11'.repeat(65)}` }),
}));

const CHECKOUT: CheckoutResponse = {
  ok: true,
  walletAddress: WALLET,
  chainId: 80002,
  blockNumber: 900,
  usdtAmount: '50000000',
  shares: '10',
  shareAmount: '10000000',
  fundsAmount: '40000000',
  feeAmount: '10000000',
  remainderAmount: '0',
  kycStatus: 'approved',
  identityVerified: true,
  compliant: true,
  usdtBalance: '100000000',
  allowance: '0',
  needsApproval: true,
  blockers: [],
  contracts: {
    usdt: '0x3333333333333333333333333333333333333333',
    escrow: '0x4444444444444444444444444444444444444444',
    forwarder: '0x5555555555555555555555555555555555555555',
  },
  usdtName: 'Mock USDT',
  usdtMetaNonce: '2',
  forwarderNonce: '5',
};

type Call = { url: string; body: unknown };

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = Object.keys(routes).find((route) => url.startsWith(route));
      const route = key ? routes[key] : undefined;
      return route ? Response.json(route.body, { status: route.status ?? 200 }) : Response.json({}, { status: 404 });
    }),
  );
  return calls;
}

const RELAY_OK = {
  '/api/mint/quotes': { body: { ok: true, quote: { intentId: INTENT } } },
  '/api/relayer/approve': { body: { ok: true, txHash: '0xa' } },
  '/api/relayer/deposit': { body: { ok: true, txHash: '0xd' } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runPurchase', () => {
  it('quotes, approves exactly the amount, then deposits, signing twice', async () => {
    const calls = stubApi(RELAY_OK);
    const signed: string[] = [];
    const signTypedData: SignTypedData = async (typed) => {
      signed.push(typed.primaryType);
      return '0xsig';
    };
    const steps: string[] = [];

    const result = await runPurchase({ checkout: CHECKOUT, signTypedData, onStep: (step) => steps.push(step) });

    expect(result).toEqual({ intentId: INTENT });
    expect(steps).toEqual(['quote', 'approve', 'deposit']);
    expect(signed).toEqual(['MetaTransaction', 'ForwardRequest']);
    expect(calls.map((call) => call.url)).toEqual(['/api/mint/quotes', '/api/relayer/approve', '/api/relayer/deposit']);
    expect(calls[0].body).toEqual({ wallet: WALLET, usdtAmount: '50000000' });

    const approval = calls[1].body as { from: string; functionSignature: string };
    expect(approval.from).toBe(WALLET);
    // approve(escrow, 50 USDT): the exact quoted amount.
    expect(approval.functionSignature).toBe(
      `0x095ea7b3${'4'.repeat(40).padStart(64, '0')}${50_000_000n.toString(16).padStart(64, '0')}`,
    );

    const deposit = calls[2].body as { request: Record<string, string>; signature: string };
    expect(deposit.request).toMatchObject({ from: WALLET, to: CHECKOUT.contracts.escrow, value: '0', nonce: '5' });
    expect(deposit.request.data.startsWith(`0x1de26e16${'ab'.repeat(32)}`)).toBe(true);
  });

  it('skips the approval when the allowance already covers the amount', async () => {
    const calls = stubApi(RELAY_OK);
    await runPurchase({ checkout: { ...CHECKOUT, needsApproval: false }, signTypedData: async () => '0xsig' });
    expect(calls.map((call) => call.url)).toEqual(['/api/mint/quotes', '/api/relayer/deposit']);
  });

  it('stops at the failing step with the API reason', async () => {
    stubApi({ ...RELAY_OK, '/api/relayer/approve': { status: 403, body: { ok: false, reason: 'wrong_wallet' } } });
    const attempt = runPurchase({ checkout: CHECKOUT, signTypedData: async () => '0xsig' });
    await expect(attempt).rejects.toEqual(new PurchaseError('approve', 'wrong_wallet'));
    expect(purchaseErrorText(new PurchaseError('approve', 'wrong_wallet'))).toBe(
      'Switch your wallet back to the account you signed in with.',
    );
    expect(purchaseErrorText(new Error('User rejected the request.'))).toBe(
      'You cancelled the signature in your wallet. Nothing was sent.',
    );
  });
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CheckoutView />
    </QueryClientProvider>,
  );
}

describe('CheckoutView', () => {
  it('lists every blocker and keeps the buy button disabled', async () => {
    stubApi({
      '/api/investor/checkout': {
        body: {
          ...CHECKOUT,
          kycStatus: 'pending',
          identityVerified: false,
          usdtBalance: '1000000',
          blockers: ['kyc_not_approved', 'identity_not_verified', 'insufficient_usdt'],
        },
      },
    });
    renderView();

    expect(await screen.findByText('Complete identity verification (KYC) before buying.')).toBeTruthy();
    expect(screen.getByText(/does not hold enough USDT/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Buy 10 shares/ })).toBeDisabled();
  });

  it('asks a signed-out visitor to sign in', async () => {
    stubApi({ '/api/investor/checkout': { status: 401, body: { ok: false, reason: 'unauthenticated' } } });
    renderView();
    expect(await screen.findByText('Sign in to buy')).toBeTruthy();
  });

  it('buys and follows the purchase until the shares are minted', async () => {
    stubApi({
      '/api/investor/checkout': { body: CHECKOUT },
      ...RELAY_OK,
      [`/api/investor/quotes/${INTENT}`]: {
        body: {
          ok: true,
          currentBlock: 950,
          quote: {
            intentId: INTENT,
            status: 'minted',
            usdtAmount: '50000000',
            fundsAmount: '40000000',
            feeAmount: '10000000',
            remainderAmount: '0',
            shares: '10',
            shareAmount: '10000000',
            quoteExpiresAt: '2026-09-30T09:15:00.000Z',
            rejectReason: null,
            deposit: { txHash: '0xdep', blockNumber: 930, amount: '50000000' },
            confirmations: { current: 12, required: 12 },
            mintTxHash: '0xmint',
          },
        },
      },
    });
    renderView();

    // The button shows at once (disabled); wait for the pre-flight summary.
    expect(await screen.findByText('50 USDT')).toBeTruthy();
    const button = screen.getByRole('button', { name: /Buy 10 shares/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(await screen.findByText('10 EQOWAG are in your wallet.')).toBeTruthy();
    expect(screen.getByText('Mint transaction').closest('a')).toHaveAttribute(
      'href',
      'https://amoy.polygonscan.com/tx/0xmint',
    );
  });

  it('refuses to sign when the wallet switched away from the session account', async () => {
    stubApi({
      '/api/investor/checkout': { body: { ...CHECKOUT, walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' } },
    });
    renderView();
    expect(await screen.findByRole('alert')).toHaveTextContent('Switch back to the account you signed in with');
    expect(screen.getByRole('button', { name: /Buy 10 shares/ })).toBeDisabled();
  });
});
