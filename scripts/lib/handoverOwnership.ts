import { ethers } from 'hardhat';
import type { Signer } from 'ethers';

const OWNABLE_ABI = ['function owner() view returns (address)', 'function transferOwnership(address newOwner)'];

const AGENT_ABI = [
  'function isAgent(address) view returns (bool)',
  'function addAgent(address)',
  'function removeAgent(address)',
];

const FACTORY_ABI = [
  'function owner() view returns (address)',
  'function recoverContractOwnership(address _contract, address _newOwner)',
];

export type HandoverTargets = {
  safe: string;
  agent: string;
  deployer: string;
  token: string;
  identityRegistry: string;
  identityRegistryStorage: string;
  compliance: string;
  claimTopicsRegistry: string;
  trustedIssuersRegistry: string;
  trexFactory: string;
  trexImplementationAuthority: string;
  identityFactory: string;
  identityImplementationAuthority: string;
  modules: string[];
};

async function transferIfNeeded(address: string, safe: string, signer: Signer, label: string) {
  const owned = new ethers.Contract(address, OWNABLE_ABI, signer);
  const current: string = await owned.owner();

  if (ethers.getAddress(current) === ethers.getAddress(safe)) {
    console.log(`${label} already owned by the Safe`);
    return;
  }

  if (ethers.getAddress(current) !== ethers.getAddress(await signer.getAddress())) {
    throw new Error(`${label} is owned by ${current}, not the deployer`);
  }

  await (await owned.transferOwnership(safe)).wait();
  console.log(`${label} -> Safe`);
}

/**
 * IdentityRegistryStorage is created by TREXFactory and stays factory-owned.
 * recoverContractOwnership must run while the factory itself is still ours.
 */
async function recoverFromFactory(
  factoryAddress: string,
  contractAddress: string,
  safe: string,
  signer: Signer,
  label: string,
) {
  const owned = new ethers.Contract(contractAddress, OWNABLE_ABI, signer);
  const current: string = await owned.owner();

  if (ethers.getAddress(current) === ethers.getAddress(safe)) {
    console.log(`${label} already owned by the Safe`);
    return;
  }

  if (ethers.getAddress(current) === ethers.getAddress(await signer.getAddress())) {
    await (await owned.transferOwnership(safe)).wait();
    console.log(`${label} -> Safe`);
    return;
  }

  if (ethers.getAddress(current) !== ethers.getAddress(factoryAddress)) {
    throw new Error(`${label} is owned by ${current}, not the factory or the deployer`);
  }

  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, signer);
  const factoryOwner: string = await factory.owner();
  if (ethers.getAddress(factoryOwner) !== ethers.getAddress(await signer.getAddress())) {
    throw new Error(`${label} is factory-owned, but the factory is owned by ${factoryOwner}`);
  }

  await (await factory.recoverContractOwnership(contractAddress, safe)).wait();
  console.log(`${label} -> Safe (via factory)`);
}

/**
 * Hands every leftover admin right to the Safe and strips the deployer of
 * AGENT_ROLE. On the production path the suite is still deployer-owned so
 * this script can remove the temporary agent role before ownership moves.
 */
export async function handoverOwnership(targets: HandoverTargets, signer: Signer) {
  const { safe, agent, deployer } = targets;

  // AGENT_ROLE changes are onlyOwner. Do them before the token and registry
  // leave the deployer.
  const token = new ethers.Contract(targets.token, AGENT_ABI, signer);
  const identityRegistry = new ethers.Contract(targets.identityRegistry, AGENT_ABI, signer);

  if (!(await token.isAgent(agent))) {
    await (await token.addAgent(agent)).wait();
    console.log('Granted AGENT_ROLE on token');
  }
  if (!(await identityRegistry.isAgent(agent))) {
    await (await identityRegistry.addAgent(agent)).wait();
    console.log('Granted AGENT_ROLE on identity registry');
  }

  if (await token.isAgent(deployer)) {
    await (await token.removeAgent(deployer)).wait();
    console.log('Removed deployer AGENT_ROLE on token');
  }
  if (await identityRegistry.isAgent(deployer)) {
    await (await identityRegistry.removeAgent(deployer)).wait();
    console.log('Removed deployer AGENT_ROLE on identity registry');
  }

  await recoverFromFactory(
    targets.trexFactory,
    targets.identityRegistryStorage,
    safe,
    signer,
    'IdentityRegistryStorage',
  );
  await transferIfNeeded(targets.token, safe, signer, 'Token');
  await transferIfNeeded(targets.identityRegistry, safe, signer, 'IdentityRegistry');
  await transferIfNeeded(targets.compliance, safe, signer, 'ModularCompliance');
  await transferIfNeeded(targets.claimTopicsRegistry, safe, signer, 'ClaimTopicsRegistry');
  await transferIfNeeded(targets.trustedIssuersRegistry, safe, signer, 'TrustedIssuersRegistry');
  await transferIfNeeded(targets.trexImplementationAuthority, safe, signer, 'TREXImplementationAuthority');
  await transferIfNeeded(targets.identityFactory, safe, signer, 'IdentityFactory');
  await transferIfNeeded(targets.identityImplementationAuthority, safe, signer, 'IdentityImplementationAuthority');

  for (const [index, moduleAddress] of targets.modules.entries()) {
    await transferIfNeeded(moduleAddress, safe, signer, `Module ${index + 1}`);
  }

  await transferIfNeeded(targets.trexFactory, safe, signer, 'TREXFactory');
}

/** Fails if the deployer still owns any listed contract or still holds AGENT_ROLE. */
export async function assertDeployerHasNoAdmin(targets: HandoverTargets) {
  const checks = [
    ['token', targets.token],
    ['identityRegistry', targets.identityRegistry],
    ['identityRegistryStorage', targets.identityRegistryStorage],
    ['compliance', targets.compliance],
    ['claimTopicsRegistry', targets.claimTopicsRegistry],
    ['trustedIssuersRegistry', targets.trustedIssuersRegistry],
    ['trexFactory', targets.trexFactory],
    ['trexImplementationAuthority', targets.trexImplementationAuthority],
    ['identityFactory', targets.identityFactory],
    ['identityImplementationAuthority', targets.identityImplementationAuthority],
    ...targets.modules.map((address, index): [string, string] => [`module:${index + 1}`, address]),
  ] as const;

  for (const [label, address] of checks) {
    const owned = new ethers.Contract(address, OWNABLE_ABI, ethers.provider);
    const owner: string = await owned.owner();
    if (ethers.getAddress(owner) === ethers.getAddress(targets.deployer)) {
      throw new Error(`Deployer still owns ${label} (${address})`);
    }
    if (ethers.getAddress(owner) !== ethers.getAddress(targets.safe)) {
      throw new Error(`${label} owner is ${owner}, expected the Safe`);
    }
  }

  const token = new ethers.Contract(targets.token, AGENT_ABI, ethers.provider);
  const identityRegistry = new ethers.Contract(targets.identityRegistry, AGENT_ABI, ethers.provider);

  if (await token.isAgent(targets.deployer)) {
    throw new Error('Deployer still has AGENT_ROLE on the token');
  }
  if (await identityRegistry.isAgent(targets.deployer)) {
    throw new Error('Deployer still has AGENT_ROLE on the identity registry');
  }
  if (!(await token.isAgent(targets.agent))) {
    throw new Error('Agent wallet is missing AGENT_ROLE on the token');
  }
  if (!(await identityRegistry.isAgent(targets.agent))) {
    throw new Error('Agent wallet is missing AGENT_ROLE on the identity registry');
  }
}
