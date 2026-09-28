import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts']),
  {
    // The web app installs viem, not ethers. These config files import ethers,
    // so even a type-only import breaks the CI typecheck, where only apps/web
    // dependencies are installed. Share browser-safe code through ethers-free
    // files (for example @config/mintStatus) instead.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'ethers', message: 'The web app uses viem. ethers is not installed here.' }],
          patterns: [
            {
              regex: '^@config/(agentMint|claims|errors|escrowEvents|forwarder|mint|relayer|tokenEvents)$',
              message:
                'This config file imports ethers, which the web app does not install. Use an ethers-free config file.',
            },
          ],
        },
      ],
    },
  },
]);
