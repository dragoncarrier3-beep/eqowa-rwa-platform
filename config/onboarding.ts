import OnchainID from '@onchain-id/solidity';
import { AbiCoder, Contract, ContractFactory, ZeroAddress, getAddress, keccak256, type Signer } from 'ethers';

import { CLAIM_DATA, CLAIM_SCHEME_ECDSA, signClaim, type ClaimSigner } from './claims';
import { REQUIRED_CLAIM_TOPICS } from './eqowa';

/**
 * Puts a KYC-approved investor on-chain: an ONCHAINID identity, the KYC and
 * residency claims signed by the trusted claim issuer, and the registry entry
 * that makes `isVerified` true. Only then can the token mint to the wallet.
 *
 * Every step first reads the chain and skips what is already done, so the
 * worker can retry after any failure without a second identity or a
 * duplicate claim. The identity is managed by the agent (custodial for
 * Phase 1): investors never sign or pay gas for their identity.
 */

const REGISTRY_ABI = [
  'function identity(address _userAddress) view returns (address)',
  'function isVerified(address _userAddress) view returns (bool)',
  'function registerIdentity(address _userAddress, address _identity, uint16 _country)',
];
const IDENTITY_ABI = [
  'function getClaim(bytes32 _claimId) view returns (uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri)',
  'function addClaim(uint256 _topic, uint256 _scheme, address _issuer, bytes _signature, bytes _data, string _uri) returns (bytes32)',
];
const CLAIM_ISSUER_ABI = ['function keyHasPurpose(bytes32 _key, uint256 _purpose) view returns (bool)'];

/** ERC-734 purpose of a key allowed to sign claims. */
const CLAIM_SIGNER_PURPOSE = 3;

export type OnboardingContracts = {
  identityRegistry: string;
  claimIssuer: string;
  /** ONCHAINID implementation authority the identity proxy points at. */
  identityImplementationAuthority: string;
};

export type OnboardingResult = {
  identityAddress: string;
  /** Transactions this run sent; empty when the investor was already verified. */
  txHashes: string[];
  alreadyVerified: boolean;
};

export class OnboardingRefused extends Error {
  constructor(
    readonly code: 'claim_signer_not_trusted' | 'invalid_country' | 'not_verified_after_onboarding',
    message: string,
  ) {
    super(message);
  }
}

/** ONCHAINID claim id: keccak256(abi.encode(issuer, topic)). */
export function claimId(issuer: string, topic: bigint): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [getAddress(issuer), topic]));
}

function addressKey(address: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [getAddress(address)]));
}

export async function onboardInvestor(params: {
  wallet: string;
  /** ISO 3166-1 numeric, as the registry stores it. */
  countryCode: number;
  contracts: OnboardingContracts;
  /** Registry agent and manager of the new identity. Pays the gas. */
  agent: Signer;
  /** Key registered for purpose 3 on the ClaimIssuer. */
  claimSigner: ClaimSigner & { getAddress(): Promise<string> };
  /** An identity deployed by an earlier, interrupted run. */
  knownIdentity?: string;
  /** Saves a freshly deployed identity before anything else can fail. */
  onIdentityDeployed?: (identityAddress: string) => Promise<void>;
}): Promise<OnboardingResult> {
  const wallet = getAddress(params.wallet);
  if (!Number.isInteger(params.countryCode) || params.countryCode <= 0 || params.countryCode > 999) {
    throw new OnboardingRefused('invalid_country', `country ${params.countryCode} is not an ISO 3166 numeric code`);
  }

  const registry = new Contract(params.contracts.identityRegistry, REGISTRY_ABI, params.agent);
  if (await registry.isVerified(wallet)) {
    return { identityAddress: getAddress(await registry.identity(wallet)), txHashes: [], alreadyVerified: true };
  }

  // Refuse before spending gas: claims from an untrusted key never verify.
  const signerAddress = await params.claimSigner.getAddress();
  const issuer = new Contract(params.contracts.claimIssuer, CLAIM_ISSUER_ABI, params.agent);
  if (!(await issuer.keyHasPurpose(addressKey(signerAddress), CLAIM_SIGNER_PURPOSE))) {
    throw new OnboardingRefused(
      'claim_signer_not_trusted',
      `${signerAddress} is not a claim signing key on the ClaimIssuer`,
    );
  }

  const txHashes: string[] = [];
  const registered = (await registry.identity(wallet)) as string;
  let identityAddress = registered !== ZeroAddress ? getAddress(registered) : undefined;
  identityAddress ??= params.knownIdentity ? getAddress(params.knownIdentity) : undefined;

  if (!identityAddress) {
    const factory = new ContractFactory(
      OnchainID.contracts.IdentityProxy.abi,
      OnchainID.contracts.IdentityProxy.bytecode,
      params.agent,
    );
    const proxy = await factory.deploy(
      params.contracts.identityImplementationAuthority,
      await params.agent.getAddress(),
    );
    const receipt = await proxy.deploymentTransaction()!.wait();
    identityAddress = getAddress(await proxy.getAddress());
    txHashes.push(receipt!.hash);
    await params.onIdentityDeployed?.(identityAddress);
  }

  const identity = new Contract(identityAddress, IDENTITY_ABI, params.agent);
  for (const topic of REQUIRED_CLAIM_TOPICS) {
    const existing = await identity.getClaim(claimId(params.contracts.claimIssuer, topic));
    if (getAddress(existing.issuer) === getAddress(params.contracts.claimIssuer)) {
      continue;
    }
    const signature = await signClaim(params.claimSigner, identityAddress, topic);
    const tx = await identity.addClaim(
      topic,
      CLAIM_SCHEME_ECDSA,
      params.contracts.claimIssuer,
      signature,
      CLAIM_DATA,
      '',
    );
    txHashes.push((await tx.wait()).hash);
  }

  if (registered === ZeroAddress) {
    const tx = await registry.registerIdentity(wallet, identityAddress, params.countryCode);
    txHashes.push((await tx.wait()).hash);
  }

  if (!(await registry.isVerified(wallet))) {
    throw new OnboardingRefused(
      'not_verified_after_onboarding',
      'identity is registered with claims but the registry does not verify it; check the trusted issuers and claim topics',
    );
  }
  return { identityAddress, txHashes, alreadyVerified: false };
}
