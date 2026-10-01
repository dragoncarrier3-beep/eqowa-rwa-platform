import { AbiCoder, Contract, TypedDataEncoder, getAddress, keccak256, type Provider } from 'ethers';

import { usdtMetaDomain } from '../../config/usdtMetaTx';

/**
 * Read-only checks before and after a Polygon mainnet deploy. Nothing here
 * sends a transaction. Each check says what it looked at, so the printed list
 * doubles as the record for the launch runbook (docs/MAINNET.md).
 */
export type PreflightCheck = { name: string; ok: boolean; detail: string };

const USDT_ABI = [
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function getDomainSeperator() view returns (bytes32)',
];
const SAFE_ABI = ['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'];
const CLAIM_ISSUER_ABI = ['function keyHasPurpose(bytes32 _key, uint256 _purpose) view returns (bool)'];
const AGENT_ABI = ['function isAgent(address _agent) view returns (bool)'];
const OWNABLE_ABI = ['function owner() view returns (address)'];

/** ERC-734 purpose of a claim signing key. */
const CLAIM_SIGNER_PURPOSE = 3n;

const pass = (name: string, detail: string): PreflightCheck => ({ name, ok: true, detail });
const fail = (name: string, detail: string): PreflightCheck => ({ name, ok: false, detail });

async function hasCode(provider: Provider, address: string) {
  return (await provider.getCode(address)) !== '0x';
}

/**
 * Native USDT has 6 decimals and a meta-transaction domain the gasless
 * approval signs against. If the domain the contract reports differs from the
 * one config/usdtMetaTx.ts builds, every investor approval would be refused.
 */
export async function checkUsdt(provider: Provider, usdtAddress: string, chainId: bigint): Promise<PreflightCheck[]> {
  const address = getAddress(usdtAddress);
  if (!(await hasCode(provider, address))) {
    return [fail('USDT contract', `${address} has no code`)];
  }
  const usdt = new Contract(address, USDT_ABI, provider);
  const checks: PreflightCheck[] = [pass('USDT contract', address)];
  const decimals = Number(await usdt.decimals());
  checks.push(
    decimals === 6 ? pass('USDT decimals', '6') : fail('USDT decimals', `${decimals}, the platform expects 6`),
  );
  const name = String(await usdt.name());
  const expected = TypedDataEncoder.hashDomain(usdtMetaDomain({ name, verifyingContract: address, chainId }));
  const actual = String(await usdt.getDomainSeperator());
  checks.push(
    actual === expected
      ? pass('USDT meta-transaction domain', `matches for "${name}"`)
      : fail('USDT meta-transaction domain', `contract ${actual}, config builds ${expected}`),
  );
  return checks;
}

/**
 * The Safe exists, needs at least `minThreshold` signatures, has the agreed
 * owners when they are given, and none of the hot keys is an owner.
 */
export async function checkSafe(
  provider: Provider,
  safeAddress: string,
  options: { minThreshold?: number; expectedOwners?: string[]; hotKeys?: Record<string, string> } = {},
): Promise<PreflightCheck[]> {
  const address = getAddress(safeAddress);
  if (!(await hasCode(provider, address))) {
    return [fail('Gnosis Safe', `${address} has no code. Create the Safe first.`)];
  }
  const safe = new Contract(address, SAFE_ABI, provider);
  const owners = ((await safe.getOwners()) as string[]).map((owner) => getAddress(owner));
  const threshold = Number(await safe.getThreshold());
  const minThreshold = options.minThreshold ?? 2;
  const checks: PreflightCheck[] = [
    pass('Gnosis Safe', address),
    threshold >= minThreshold
      ? pass('Safe threshold', `${threshold} of ${owners.length}`)
      : fail('Safe threshold', `${threshold} of ${owners.length}, needs at least ${minThreshold}`),
  ];
  if (options.expectedOwners?.length) {
    const expected = options.expectedOwners.map((owner) => getAddress(owner)).sort();
    const same = expected.length === owners.length && [...owners].sort().every((owner, i) => owner === expected[i]);
    checks.push(
      same
        ? pass('Safe owners', owners.join(', '))
        : fail('Safe owners', `on chain ${owners.join(', ')}, expected ${expected.join(', ')}`),
    );
  }
  for (const [label, key] of Object.entries(options.hotKeys ?? {})) {
    const isOwner = owners.includes(getAddress(key));
    checks.push(
      isOwner ? fail(`${label} is not a Safe owner`, `${key} is an owner`) : pass(`${label} is not a Safe owner`, key),
    );
  }
  return checks;
}

/** The API's claim signing key is a purpose-3 key on the trusted ClaimIssuer. */
export async function checkClaimSigner(
  provider: Provider,
  claimIssuer: string,
  signerAddress: string,
): Promise<PreflightCheck> {
  const issuer = new Contract(getAddress(claimIssuer), CLAIM_ISSUER_ABI, provider);
  const key = keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [getAddress(signerAddress)]));
  return (await issuer.keyHasPurpose(key, CLAIM_SIGNER_PURPOSE))
    ? pass('Claim signer on the ClaimIssuer', signerAddress)
    : fail('Claim signer on the ClaimIssuer', `${signerAddress} is not a claim signing key (purpose 3)`);
}

/** The agent wallet the API signs with is an agent of the token and the registry. */
export async function checkAgent(
  provider: Provider,
  contracts: { token: string; identityRegistry: string },
  agent: string,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  for (const [label, address] of [
    ['token', contracts.token],
    ['identity registry', contracts.identityRegistry],
  ] as const) {
    const isAgent = await new Contract(getAddress(address), AGENT_ABI, provider).isAgent(getAddress(agent));
    checks.push(
      isAgent
        ? pass(`Agent on the ${label}`, agent)
        : fail(`Agent on the ${label}`, `${agent} is not an agent of ${address}`),
    );
  }
  return checks;
}

/** After the handover script, the Safe owns every contract and the deployer none. */
export async function checkOwnedBySafe(
  provider: Provider,
  contracts: Record<string, string>,
  safe: string,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  for (const [label, address] of Object.entries(contracts)) {
    const owner = getAddress(await new Contract(getAddress(address), OWNABLE_ABI, provider).owner());
    checks.push(
      owner === getAddress(safe)
        ? pass(`${label} owned by the Safe`, address)
        : fail(`${label} owned by the Safe`, `owner is ${owner}`),
    );
  }
  return checks;
}

/** A wallet that pays gas holds at least `minWei`. */
export async function checkFunded(
  provider: Provider,
  label: string,
  address: string,
  minWei: bigint,
  format: (wei: bigint) => string,
): Promise<PreflightCheck> {
  const balance = await provider.getBalance(getAddress(address));
  return balance >= minWei
    ? pass(`${label} funded`, `${format(balance)} at ${address}`)
    : fail(`${label} funded`, `${format(balance)} at ${address}, needs ${format(minWei)}`);
}

export function renderChecks(checks: PreflightCheck[]): string {
  return checks.map((check) => `${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`).join('\n');
}
