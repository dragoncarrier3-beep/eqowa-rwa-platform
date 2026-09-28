import { createConfig, http, type Config, type CreateConnectorFn } from 'wagmi';
import type { Chain } from 'viem';
import { hardhat, polygon, polygonAmoy } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

const SUPPORTED_CHAINS = [hardhat, polygonAmoy, polygon] as const;

/** The one chain this deployment runs on, from NEXT_PUBLIC_CHAIN_ID (31337, 80002 or 137). */
export function appChainFor(chainId: number): Chain {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId) ?? polygonAmoy;
}

export const APP_CHAIN: Chain = appChainFor(Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 80002));

/**
 * MetaMask and other browser wallets through `injected`, phones through
 * WalletConnect when a project id is set. Investors never pay gas, so the
 * RPC is only used for reads.
 */
export function createWagmiConfig(): Config {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const connectors: CreateConnectorFn[] = [injected()];
  if (projectId) {
    connectors.push(
      walletConnect({
        projectId,
        showQrModal: true,
        metadata: {
          name: 'EQOWA',
          description: 'EQOWA Group Shares investor portal',
          url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.eqowa.com',
          icons: [],
        },
      }),
    );
  }

  return createConfig({
    chains: [APP_CHAIN],
    connectors,
    // Empty falls back to the chain's public RPC. Never put a keyed provider
    // URL here: NEXT_PUBLIC_ values ship to every browser.
    transports: { [APP_CHAIN.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined) },
    ssr: true,
  });
}
