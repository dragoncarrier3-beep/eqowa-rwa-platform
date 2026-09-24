import { AGENT_WALLET_ADDRESS, AMOY_SAFE_OWNERS, AMOY_SAFE_THRESHOLD, DEPLOYER_ADDRESS } from '../../config/wallets';
import { ALLOWED_COUNTRIES, TOKEN_DECIMALS, TOKEN_NAME, TOKEN_SYMBOL } from '../../config/eqowa';
import type { EqowaDeployment } from './deploymentFile';

export const MILESTONE_TAG = 'v0.1.0-m1';
export const AMOY_EXPLORER = 'https://amoy.polygonscan.com';

export type PublicContracts = {
  token: string;
  identityRegistry: string;
  identityRegistryStorage: string;
  claimTopicsRegistry: string;
  trustedIssuersRegistry: string;
  compliance: string;
  trexFactory: string;
  trexImplementationAuthority: string;
  identityFactory: string;
  identityImplementationAuthority: string;
  claimIssuer: string;
  modules: EqowaDeployment['modules'];
  implementations: EqowaDeployment['implementations'];
  settlement: { usdt: string; forwarder: string; escrow: string } | null;
};

export type PublicAddresses = {
  version: string;
  network: string;
  chainId: number;
  explorer: string;
  status: 'not-deployed' | 'deployed';
  token: {
    name: string;
    symbol: string;
    decimals: number;
  };
  compliance: {
    maxBalanceShares: number;
    maxHolderCount: number;
    lockupDays: number;
    dailyMintCapShares: number;
    allowedCountryCount: number;
    claimTopics: number[];
  };
  wallets: {
    deployer: string;
    agent: string;
    safe: string | null;
    safeOwners: readonly string[];
    safeThreshold: number;
  };
  contracts: PublicContracts | null;
};

function tokenAndRules() {
  return {
    token: {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      decimals: TOKEN_DECIMALS,
    },
    compliance: {
      maxBalanceShares: 150_000,
      maxHolderCount: 500,
      lockupDays: 730,
      dailyMintCapShares: 250_000,
      allowedCountryCount: ALLOWED_COUNTRIES.length,
      claimTopics: [1, 2],
    },
  };
}

/** Committed stub until Amoy is live. */
export function pendingPublicAddresses(): PublicAddresses {
  return {
    version: MILESTONE_TAG,
    network: 'polygon-amoy',
    chainId: 80002,
    explorer: AMOY_EXPLORER,
    status: 'not-deployed',
    ...tokenAndRules(),
    wallets: {
      deployer: DEPLOYER_ADDRESS,
      agent: AGENT_WALLET_ADDRESS,
      safe: null,
      safeOwners: AMOY_SAFE_OWNERS,
      safeThreshold: AMOY_SAFE_THRESHOLD,
    },
    contracts: null,
  };
}

export function publicAddressesFromDeployment(deployment: EqowaDeployment): PublicAddresses {
  return {
    version: MILESTONE_TAG,
    network: 'polygon-amoy',
    chainId: deployment.chainId,
    explorer: AMOY_EXPLORER,
    status: 'deployed',
    ...tokenAndRules(),
    wallets: {
      deployer: deployment.deployer,
      agent: deployment.agent,
      safe: deployment.safe,
      safeOwners: AMOY_SAFE_OWNERS,
      safeThreshold: AMOY_SAFE_THRESHOLD,
    },
    contracts: {
      token: deployment.token,
      identityRegistry: deployment.identityRegistry,
      identityRegistryStorage: deployment.identityRegistryStorage,
      claimTopicsRegistry: deployment.claimTopicsRegistry,
      trustedIssuersRegistry: deployment.trustedIssuersRegistry,
      compliance: deployment.compliance,
      trexFactory: deployment.trexFactory,
      trexImplementationAuthority: deployment.trexImplementationAuthority,
      identityFactory: deployment.identityFactory,
      identityImplementationAuthority: deployment.identityImplementationAuthority,
      claimIssuer: deployment.claimIssuer,
      modules: deployment.modules,
      implementations: deployment.implementations,
      settlement: deployment.settlement
        ? {
            usdt: deployment.settlement.usdt,
            forwarder: deployment.settlement.forwarder,
            escrow: deployment.settlement.escrow,
          }
        : null,
    },
  };
}
