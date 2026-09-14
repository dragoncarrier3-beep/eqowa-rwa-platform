import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import Fastify from 'fastify';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ ok: true, service: 'eqowa-api' }));

  app.get('/ready', async (_request, reply) => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(503).send({ ok: false, reason: 'DATABASE_URL is not set' });
    }

    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { ok: true };
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        reason: error instanceof Error ? error.message : 'database unreachable',
      });
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  return app;
}

async function main() {
  const app = buildApp();
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
