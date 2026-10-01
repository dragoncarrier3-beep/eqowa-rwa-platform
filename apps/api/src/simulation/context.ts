import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AbiCoder,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  concat,
  getAddress,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from 'ethers';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** localhost: a Hardhat node. shared: the Anvil test chain on the server. Both use the public test keys. */
export type SimNetwork = 'localhost' | 'shared' | 'amoy';

/** Public Hardhat test accounts #0 and #2 (Anvil has the same ones). Only ever used on a test chain. */
export const HARDHAT_OPERATOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const HARDHAT_AGENT_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
export const HARDHAT_SAFE_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
export const HARDHAT_AGENT_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

export const AMOY_EXPLORER = 'https://amoy.polygonscan.com';

/** The fields of deployments/<network>.json the simulation reads. */
export type SimDeployment = {
  network: string;
  chainId: number;
  safe: string;
  agent: string;
  claimIssuer: string;
  token: string;
  identityRegistry: string;
  compliance: string;
  identityImplementationAuthority: string;
  modules: {
    countryAllowlist: string;
    timeLockup: string;
    balanceCap?: string;
    holderCountCap?: string;
    dailyMintCap?: string;
  };
  settlement?: { owner: string; usdt: string; forwarder: string; escrow: string; escrowDeployBlock: number };
};

export async function loadDeployment(
  network: SimNetwork,
): Promise<SimDeployment & { settlement: NonNullable<SimDeployment['settlement']> }> {
  const file = path.join(REPO_ROOT, 'deployments', `${network}.json`);
  let deployment: SimDeployment;
  try {
    deployment = JSON.parse(await readFile(file, 'utf8')) as SimDeployment;
  } catch {
    throw new Error(`${file} not found. Deploy the suite and the settlement contracts first.`);
  }
  if (!deployment.settlement) {
    throw new Error(`${file} has no settlement block. Run deploy-settlement on ${network} first.`);
  }
  return deployment as SimDeployment & { settlement: NonNullable<SimDeployment['settlement']> };
}

export type SimContext = ReturnType<typeof createContext>;

/**
 * Keys and wallets for one simulation run.
 *
 * Operator: pays gas, funds test wallets, deploys test identities and signs
 * their KYC claims. On Amoy this is the deployer, which is the ClaimIssuer
 * management key. Agent: registers identities and mints, as in production.
 * Investor wallets are derived per run from the operator key, so a rerun on
 * Amoy never collides with identities registered by an earlier run. Their
 * keys are never written anywhere.
 */
export function createContext(network: SimNetwork, env: NodeJS.ProcessEnv = process.env) {
  const local = network !== 'amoy';
  const rpcUrl = local ? (env.SIM_RPC_URL ?? 'http://127.0.0.1:8545') : env.AMOY_RPC_URL;
  if (!rpcUrl) {
    throw new Error('Set AMOY_RPC_URL');
  }
  const operatorKey = local ? HARDHAT_OPERATOR_KEY : env.DEPLOYER_PRIVATE_KEY;
  const agentKey = local ? HARDHAT_AGENT_KEY : env.AGENT_SIGNER_PRIVATE_KEY;
  if (!operatorKey || !agentKey) {
    throw new Error('Set DEPLOYER_PRIVATE_KEY and AGENT_SIGNER_PRIVATE_KEY for the Amoy simulation');
  }
  const relayerKey = local ? agentKey : env.RELAYER_PRIVATE_KEY || agentKey;

  // cacheTimeout -1: ethers otherwise reuses a getBlockNumber answer for 250 ms,
  // and local rounds run faster than that, so the worker would never see the
  // 12 blocks it waits for.
  const provider = new JsonRpcProvider(rpcUrl, undefined, {
    pollingInterval: local ? 200 : 4000,
    cacheTimeout: -1,
  });
  const operatorWallet = new Wallet(operatorKey, provider);
  const agentWallet = new Wallet(agentKey, provider);
  // One nonce manager per account. The relayer usually is the agent account,
  // and two managers on one account would hand out the same nonce twice.
  const operator = new NonceManager(operatorWallet);
  const agent = new NonceManager(agentWallet);
  const relayer =
    getAddress(new Wallet(relayerKey).address) === agentWallet.address
      ? agent
      : new NonceManager(new Wallet(relayerKey, provider));

  const runId = env.SIM_RUN_ID ?? new Date().toISOString();
  const investor = (name: string) => {
    const wallet = new Wallet(keccak256(concat([operatorKey, toUtf8Bytes(`eqowa-sim:${runId}:${name}`)])), provider);
    return { name, address: wallet.address, wallet, signer: new NonceManager(wallet) };
  };

  return {
    network,
    provider,
    runId,
    operatorWallet,
    operator,
    agentWallet,
    agent,
    relayer,
    investors: { alice: investor('alice'), david: investor('david'), charlie: investor('charlie') },
    /** Gas money for a test wallet that has to sign its own transactions. */
    investorGas: parseEther(local ? '1' : '0.02'),
    /** Floor for the agent, which relays deposits and sends every mint. */
    agentGasFloor: parseEther(local ? '1' : '0.1'),
    txUrl: (hash: string) => (network === 'amoy' ? `${AMOY_EXPLORER}/tx/${hash}` : undefined),
    addressUrl: (address: string) => (network === 'amoy' ? `${AMOY_EXPLORER}/address/${address}` : undefined),
    /**
     * Moves the chain forward far enough for the settlement worker to act.
     * Locally that is 12 mined blocks; on Amoy it is waiting for real ones.
     */
    async advance() {
      if (local) {
        await provider.send(network === 'shared' ? 'anvil_mine' : 'hardhat_mine', ['0xc']);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    },
    /** Rounds of `advance` before giving up on the chain. */
    maxRounds: local ? 6 : 120,
  };
}

/** ERC-734 key hash for an address. */
export function addressKey(address: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [address]));
}
