import { proxyToApi } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  const { path } = await context.params;
  return proxyToApi(request, path, process.env.API_INTERNAL_URL);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
