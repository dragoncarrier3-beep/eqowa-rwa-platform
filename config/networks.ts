/**
 * Chains the platform runs on. Browser-safe: the web app reads explorer links
 * and the native USDT address from here, the API and scripts read the same.
 */

export type NetworkKey = 'localhost' | 'amoy' | 'polygon';

export type NetworkInfo = {
  key: NetworkKey;
  chainId: number;
  name: string;
  nativeCurrency: 'ETH' | 'POL';
  testnet: boolean;
  /** Null for a local node, which has no block explorer. */
  explorerUrl: string | null;
  /** Native USDT on the chain. Null where the settlement deploy brings MockUSDT. */
  usdtAddress: string | null;
};

export const NETWORKS: Record<NetworkKey, NetworkInfo> = {
  // Hardhat node and the Anvil shared test chain both use 31337.
  localhost: {
    key: 'localhost',
    chainId: 31337,
    name: 'Local test chain',
    nativeCurrency: 'ETH',
    testnet: true,
    explorerUrl: null,
    usdtAddress: null,
  },
  amoy: {
    key: 'amoy',
    chainId: 80002,
    name: 'Polygon Amoy',
    nativeCurrency: 'POL',
    testnet: true,
    explorerUrl: 'https://amoy.polygonscan.com',
    usdtAddress: null,
  },
  polygon: {
    key: 'polygon',
    chainId: 137,
    name: 'Polygon',
    nativeCurrency: 'POL',
    testnet: false,
    explorerUrl: 'https://polygonscan.com',
    usdtAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
};

export function networkByChainId(chainId: number): NetworkInfo | undefined {
  return Object.values(NETWORKS).find((network) => network.chainId === chainId);
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const explorer = networkByChainId(chainId)?.explorerUrl;
  return explorer ? `${explorer}/address/${address}` : null;
}

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const explorer = networkByChainId(chainId)?.explorerUrl;
  return explorer ? `${explorer}/tx/${txHash}` : null;
}
