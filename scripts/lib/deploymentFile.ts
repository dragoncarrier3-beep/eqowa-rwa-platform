import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export type EqowaDeployment = {
  network: string;
  chainId: number;
  suiteSalt: string;
  deployer: string;
  safe: string;
  agent: string;
  claimIssuer: string;
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
  modules: {
    countryAllowlist: string;
    balanceCap: string;
    holderCountCap: string;
    timeLockup: string;
    dailyMintCap: string;
  };
  implementations: {
    token: string;
    claimTopicsRegistry: string;
    trustedIssuersRegistry: string;
    identityRegistry: string;
    identityRegistryStorage: string;
    modularCompliance: string;
    countryAllowlist: string;
    balanceCap: string;
    holderCountCap: string;
    timeLockup: string;
    dailyMintCap: string;
  };
  /** Set when deploy.ts created the ClaimIssuer. Used for Polygonscan verify. */
  claimIssuerManagementKey?: string;
  /** Set by deploySettlement.ts once the escrow stack is live. */
  settlement?: SettlementDeployment;
};

export type SettlementDeployment = {
  owner: string;
  usdt: string;
  forwarder: string;
  escrow: string;
  /** First block the settlement worker needs to scan (INDEX_FROM_BLOCK). */
  escrowDeployBlock: number;
};

/**
 * Attach a settlement stack to an existing suite record. Refuses to replace one
 * unless forced, so a second run cannot silently orphan the escrow that holds
 * investor USDT.
 */
export function withSettlement(
  deployment: EqowaDeployment,
  settlement: SettlementDeployment,
  options: { force?: boolean } = {},
): EqowaDeployment {
  if (deployment.settlement && !options.force) {
    throw new Error(
      `Settlement already deployed at escrow ${deployment.settlement.escrow}. Set FORCE_SETTLEMENT_DEPLOY=true to replace it.`,
    );
  }
  return { ...deployment, settlement };
}

export function deploymentPath(network: string): string {
  return path.join('deployments', `${network}.json`);
}

export async function writeDeployment(network: string, deployment: EqowaDeployment): Promise<string> {
  const filePath = deploymentPath(network);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(deployment, null, 2)}\n`);
  return filePath;
}

export async function readDeployment(network: string): Promise<EqowaDeployment> {
  return JSON.parse(await readFile(deploymentPath(network), 'utf8')) as EqowaDeployment;
}
