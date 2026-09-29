import type { InvestorMeResponse } from '@config/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { KycView } from '@/components/kyc-view';
import { KycTokenError, kycErrorText, requestKycToken } from '@/lib/kyc';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  handlers: {} as Record<string, (payload: unknown) => void>,
  launchedInto: null as HTMLElement | null,
  destroyed: 0,
  refresh: null as null | (() => Promise<string>),
}));

vi.mock('@sumsub/websdk', () => {
  const builder = {
    withConf: () => builder,
    withOptions: () => builder,
    on: (event: string, handler: (payload: unknown) => void) => {
      sdk.handlers[event] = handler;
      return builder;
    },
    build: () => ({
      launch: (element: HTMLElement) => {
        sdk.launchedInto = element;
      },
      destroy: () => {
        sdk.destroyed += 1;
      },
    }),
  };
  sdk.init.mockImplementation((_token: string, refresh: () => Promise<string>) => {
    sdk.refresh = refresh;
    return builder;
  });
  return { default: { init: sdk.init } };
});

const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function me(kyc: InvestorMeResponse['kyc']): InvestorMeResponse {
  return { ok: true, walletAddress: WALLET, kyc, holding: null };
}

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const route = routes[url];
      return route ? Response.json(route.body, { status: route.status ?? 200 }) : Response.json({}, { status: 404 });
    }),
  );
  return calls;
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KycView />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  sdk.init.mockClear();
  sdk.handlers = {};
  sdk.launchedInto = null;
});

describe('KycView', () => {
  it('starts Sumsub with a token for the signed-in wallet and shows review in progress once submitted', async () => {
    const calls = stubApi({
      '/api/investor/me': { body: me(null) },
      '/api/investor/kyc/token': { body: { ok: true, token: '_act-1', levelName: 'id-and-liveness' } },
    });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'Start verification' }));

    await waitFor(() => expect(sdk.init).toHaveBeenCalledWith('_act-1', expect.any(Function)));
    expect(sdk.launchedInto).toBe(screen.getByLabelText('Identity verification'));
    expect(calls).toContain('/api/investor/kyc/token');
    // The SDK refreshes an expired token through the same API route.
    expect(await sdk.refresh!()).toBe('_act-1');

    sdk.handlers['idCheck.onApplicantSubmitted']({});
    expect(await screen.findByText('Verification in review')).toBeTruthy();
  });

  it('shows a verified investor the way to buy, with no verification button', async () => {
    stubApi({
      '/api/investor/me': {
        body: me({
          status: 'approved',
          countryCode: 566,
          onchainIdAddress: '0x2222222222222222222222222222222222222222',
        }),
      },
    });
    renderView();
    expect(await screen.findByText('Identity verified')).toBeTruthy();
    expect(screen.getByText('Continue to buy shares').closest('a')).toHaveAttribute('href', '/buy');
    expect(screen.queryByRole('button', { name: /verification/i })).toBeNull();
  });

  it('lets a rejected investor try again and explains a blocked country', async () => {
    stubApi({ '/api/investor/me': { body: me({ status: 'rejected', countryCode: 566, onchainIdAddress: '0x0' }) } });
    const first = renderView();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    first.unmount();

    stubApi({
      '/api/investor/me': { body: me({ status: 'blocked_country', countryCode: 840, onchainIdAddress: '0x0' }) },
    });
    renderView();
    expect(await screen.findByText('Not available in your country')).toBeTruthy();
    expect(screen.getByText(/African Union countries, the European Union and the United Kingdom/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows why verification could not start', async () => {
    stubApi({
      '/api/investor/me': { body: me(null) },
      '/api/investor/kyc/token': { status: 503, body: { ok: false, reason: 'kyc_unavailable' } },
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Start verification' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not available right now');
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('asks a signed-out visitor to sign in', async () => {
    stubApi({ '/api/investor/me': { status: 401, body: { ok: false, reason: 'unauthenticated' } } });
    renderView();
    expect(await screen.findByText('Sign in to verify')).toBeTruthy();
  });
});

describe('requestKycToken', () => {
  it('turns a 401 into a sign-in message', async () => {
    stubApi({ '/api/investor/kyc/token': { status: 401, body: { ok: false, reason: 'unauthenticated' } } });
    await expect(requestKycToken()).rejects.toEqual(new KycTokenError('unauthenticated'));
    expect(kycErrorText(new KycTokenError('unauthenticated'))).toBe(
      'Your session ended. Sign in again with your wallet.',
    );
  });
});
