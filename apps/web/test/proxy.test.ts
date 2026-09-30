import { proxyToApi } from '@/lib/proxy';

const API = 'http://api.internal:3001';

afterEach(() => {
  vi.unstubAllGlobals();
});

function upstream(body: unknown, init: ResponseInit & { cookies?: string[] } = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  for (const cookie of init.cookies ?? []) {
    headers.append('set-cookie', cookie);
  }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

describe('API proxy', () => {
  it('forwards method, path, query, cookie and body, and returns Set-Cookie', async () => {
    const fetchMock = vi.fn<(target: URL, init: RequestInit) => Promise<Response>>(async () =>
      upstream({ ok: true }, { cookies: ['eqowa_session=abc; Path=/; HttpOnly; SameSite=Lax'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://app.eqowa.com/api/auth/siwe/verify?x=1', {
      method: 'POST',
      headers: { cookie: 'a=b', 'content-type': 'application/json', authorization: 'Bearer leak' },
      body: '{"message":"m"}',
    });
    const response = await proxyToApi(request, ['auth', 'siwe', 'verify'], API);

    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe('http://api.internal:3001/auth/siwe/verify?x=1');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"message":"m"}');
    const sent = init.headers as Headers;
    expect(sent.get('cookie')).toBe('a=b');
    // Only the listed headers pass through.
    expect(sent.get('authorization')).toBeNull();

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(['eqowa_session=abc; Path=/; HttpOnly; SameSite=Lax']);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('passes API error statuses through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream({ ok: false, reason: 'unauthenticated' }, { status: 401 })),
    );
    const response = await proxyToApi(new Request('https://app.eqowa.com/api/auth/me'), ['auth', 'me'], API);
    expect(response.status).toBe(401);
    expect((await response.json()).reason).toBe('unauthenticated');
  });

  it.each([['webhooks', 'sumsub'], ['health'], ['rpc']])('does not expose /%s to browsers', async (...path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxyToApi(new Request('https://app.eqowa.com/api/x'), path, API);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards admin routes with the session cookie but never the legacy admin key', async () => {
    const fetchMock = vi.fn<(target: URL, init: RequestInit) => Promise<Response>>(async () => upstream({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('https://app.eqowa.com/api/admin/team', {
      headers: { cookie: 'eqowa_admin=abc', 'x-admin-key': 'stolen-key' },
    });
    const response = await proxyToApi(request, ['admin', 'team'], API);
    expect(response.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe('http://api.internal:3001/admin/team');
    const sent = init.headers as Headers;
    expect(sent.get('cookie')).toBe('eqowa_admin=abc');
    expect(sent.get('x-admin-key')).toBeNull();
  });

  it('refuses path tricks', async () => {
    const response = await proxyToApi(new Request('https://app.eqowa.com/api/x'), ['auth', '..', 'admin'], API);
    expect(response.status).toBe(400);
  });

  it('answers 503 without an API URL and 502 when the API is down', async () => {
    const request = new Request('https://app.eqowa.com/api/assets');
    expect((await proxyToApi(request, ['assets'], undefined)).status).toBe(503);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const down = await proxyToApi(request, ['assets'], API);
    expect(down.status).toBe(502);
    expect((await down.json()).reason).toBe('api_unreachable');
  });
});
