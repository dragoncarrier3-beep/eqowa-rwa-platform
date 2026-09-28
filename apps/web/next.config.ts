import path from 'node:path';

import type { NextConfig } from 'next';

// The web app imports the repo-level config/*.ts (token parameters, statuses),
// which lives two folders up. The bundler and output tracing must see it.
const repoRoot = path.resolve(process.cwd(), '../..');

// Builds use webpack (`--webpack` in package.json). Turbopack renames its own
// output files while writing them, which fails on Windows when antivirus or
// indexing briefly holds a new file (EBUSY / os error 32).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Docker image for the shared test chain copies only the standalone output.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
