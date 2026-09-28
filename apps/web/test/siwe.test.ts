import { parseSiweMessage } from 'viem/siwe';

import { SignInError, signInErrorText, signInWithEthereum, walletStage } from '@/lib/siwe';

const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const LOCATION = { host: 'app.eqowa.com', origin: 'https://app.eqowa.com' };
const NOW = new Date('2026-09-29T10:00:00.000Z');
const SESSION = { kind: 'investor' as const, walletAddress: ADDRESS, expiresAt: '2026-10-06T10:00:00.000Z' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signInWithEthereum', () => {
  it('signs a message for this host and chain with the API nonce and returns the session', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url.endsWith('/nonce')
        ? Response.json({ ok: true, nonce: 'n0nce12345678', expiresAt: '2026-09-29T10:10:00.000Z' })
        : Response.json({ ok: true, session: SESSION }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const signMessage = vi.fn<(args: { message: string }) => Promise<`0x${string}`>>(async () => '0xsig');

    const session = await signInWithEthereum({
      address: ADDRESS,
      chainId: 80002,
      signMessage,
      location: LOCATION,
      now: NOW,
    });

    expect(session).toEqual(SESSION);
    const message = signMessage.mock.calls[0][0].message;
    const parsed = parseSiweMessage(message);
    expect(parsed.domain).toBe('app.eqowa.com');
    expect(parsed.uri).toBe('https://app.eqowa.com');
    expect(parsed.chainId).toBe(80002);
    expect(parsed.nonce).toBe('n0nce12345678');
    expect(parsed.address).toBe(ADDRESS);
    expect(parsed.expirationTime?.toISOString()).toBe('2026-09-29T10:10:00.000Z');

    const [verifyUrl, verifyInit] = fetchMock.mock.calls[1];
    expect(verifyUrl).toBe('/api/auth/siwe/verify');
    expect(JSON.parse(String(verifyInit?.body))).toEqual({ message, signature: '0xsig' });
  });

  it('raises the API reason when the sign-in is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/nonce')
          ? Response.json({ ok: true, nonce: 'n0nce12345678', expiresAt: '2026-09-29T10:10:00.000Z' })
          : Response.json({ ok: false, reason: 'invalid_nonce' }, { status: 401 }),
      ),
    );
    const attempt = signInWithEthereum({
      address: ADDRESS,
      chainId: 80002,
      signMessage: async () => '0xsig',
      location: LOCATION,
    });
    await expect(attempt).rejects.toEqual(new SignInError('invalid_nonce'));
  });

  it('turns failures into plain messages', () => {
    expect(signInErrorText(new SignInError('wrong_chain'))).toBe('Your wallet is on a different network.');
    expect(signInErrorText(new Error('User rejected the request.'))).toBe('Sign-in was cancelled in the wallet.');
    expect(signInErrorText(new SignInError('something_new'))).toBe('Sign-in failed. Please try again.');
  });
});

describe('walletStage', () => {
  const base = { isConnected: true, address: ADDRESS, chainId: 80002, expectedChainId: 80002, session: SESSION };

  it('walks connect, network, sign-in and signed-in', () => {
    expect(walletStage({ ...base, isConnected: false, address: undefined })).toBe('disconnected');
    expect(walletStage({ ...base, chainId: 1 })).toBe('wrong_network');
    expect(walletStage({ ...base, session: null })).toBe('needs_sign_in');
    expect(walletStage(base)).toBe('signed_in');
  });

  it('does not count a session for a different wallet', () => {
    expect(
      walletStage({ ...base, session: { ...SESSION, walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' } }),
    ).toBe('needs_sign_in');
  });
});
