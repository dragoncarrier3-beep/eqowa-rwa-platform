/**
 * Same-origin gateway from the browser to the API. The session cookie is set
 * on the web origin, so it stays HttpOnly and SameSite=Lax without CORS.
 * Only the route groups the portal uses are forwarded: webhooks and the RPC
 * proxy stay unreachable from browsers. Admin routes are forwarded with the
 * admin session cookie only: the legacy x-admin-key header is never passed on,
 * so a browser cannot use it.
 */

export const PROXIED_PREFIXES = ['auth', 'investor', 'assets', 'mint', 'relayer', 'admin'] as const;

const REQUEST_HEADERS = ['cookie', 'content-type', 'accept', 'user-agent'];
const RESPONSE_HEADERS = ['content-type', 'cache-control'];

function json(status: number, reason: string) {
  return Response.json({ ok: false, reason }, { status });
}

export async function proxyToApi(request: Request, path: string[], apiBase: string | undefined): Promise<Response> {
  if (!apiBase) {
    return json(503, 'api_unconfigured');
  }
  if (path.length === 0 || !(PROXIED_PREFIXES as readonly string[]).includes(path[0])) {
    return json(404, 'not_found');
  }
  if (path.some((segment) => segment === '..' || segment === '.' || segment.includes('/'))) {
    return json(400, 'invalid_path');
  }

  const incoming = new URL(request.url);
  const target = new URL(`/${path.map(encodeURIComponent).join('/')}`, apiBase);
  target.search = incoming.search;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return json(502, 'api_unreachable');
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
}
