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
  // No Next.js badge in the corner during `npm run dev`; builds never show it.
  devIndicators: false,
  // Docker image for the shared test chain copies only the standalone output.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  experimental: {
    externalDir: true,
  },
  webpack(config) {
    // wagmi's connector bundle references optional wallet SDKs this app does
    // not use (only injected and WalletConnect are configured). Resolve them to
    // empty modules instead of printing "Module not found" on every build.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@base-org/account': false,
      '@coinbase/wallet-sdk': false,
      '@metamask/connect-evm': false,
      accounts: false,
    };
    return config;
  },
};

export default nextConfig;
