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
};

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
