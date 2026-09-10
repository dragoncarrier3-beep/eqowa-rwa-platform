import { ethers } from 'hardhat';
import OnchainID from '@onchain-id/solidity';
import type { Signer } from 'ethers';

import {
  ALLOWED_COUNTRIES,
  DAILY_MINT_CAP,
  LOCKUP_DURATION_SECONDS,
  MAX_BALANCE,
  MAX_HOLDER_COUNT,
  REQUIRED_CLAIM_TOPICS,
  TOKEN_DECIMALS,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  chunkCountries,
} from '../../config/eqowa';

/** Salt used by the factory's CREATE2 deployment of the EQOWAG suite. */
export const SUITE_SALT = 'eqowa-group-shares';

export type DeployEqowaParams = {
  deployer: Signer;
  /** Receives ownership of the token, registries and compliance from TREXFactory. */
  owner: string;
  /** AGENT_ROLE on the token and identity registry. */
  agent: string;
  /** Existing ClaimIssuer. Trusted for both required claim topics. */
  claimIssuer: string;
  /**
   * Temporary second agent so the deployer can unpause after the factory
   * hands the token to `owner`. Removed by the ownership-transfer script.
   */
  includeDeployerAsAgent?: boolean;
  /** Override for tests that need unlocked transfers. Production uses 730 days. */
  lockupDuration?: bigint;
};

async function deployModule(name: string, proxyName: 'ModuleProxy' | 'ComplianceModuleProxy', deployer: Signer) {
  const implementation = await ethers.deployContract(name, [], deployer);
  const implementationAddress = await implementation.getAddress();
  const proxy = await ethers.deployContract(
    proxyName,
    [implementationAddress, implementation.interface.encodeFunctionData('initialize')],
    deployer,
  );

  return {
    module: await ethers.getContractAt(name, await proxy.getAddress()),
    implementation: implementationAddress,
  };
}

/**
 * Deploys implementations, ONCHAINID infrastructure, all five compliance
 * modules and the EQOWAG suite through TREXFactory. This is the production
 * path. The test fixture calls it, then adds investor identities on top.
 */
export async function deployEqowaContracts(params: DeployEqowaParams) {
  const { deployer, owner, agent, claimIssuer } = params;
  const lockupDuration = params.lockupDuration ?? LOCKUP_DURATION_SECONDS;
  const deployerAddress = await deployer.getAddress();
  const tokenAgents = params.includeDeployerAsAgent ? [agent, deployerAddress] : [agent];
  const irAgents = tokenAgents;

  const claimTopicsRegistryImpl = await ethers.deployContract('ClaimTopicsRegistry', [], deployer);
  const trustedIssuersRegistryImpl = await ethers.deployContract('TrustedIssuersRegistry', [], deployer);
  const identityRegistryStorageImpl = await ethers.deployContract('IdentityRegistryStorage', [], deployer);
  const identityRegistryImpl = await ethers.deployContract('IdentityRegistry', [], deployer);
  const modularComplianceImpl = await ethers.deployContract('ModularCompliance', [], deployer);
  const tokenImpl = await ethers.deployContract('Token', [], deployer);

  const identityImpl = await new ethers.ContractFactory(
    OnchainID.contracts.Identity.abi,
    OnchainID.contracts.Identity.bytecode,
    deployer,
  ).deploy(deployerAddress, true);
  await identityImpl.waitForDeployment();

  const identityImplementationAuthority = await new ethers.ContractFactory(
    OnchainID.contracts.ImplementationAuthority.abi,
    OnchainID.contracts.ImplementationAuthority.bytecode,
    deployer,
  ).deploy(await identityImpl.getAddress());
  await identityImplementationAuthority.waitForDeployment();

  const identityFactory = await new ethers.ContractFactory(
    OnchainID.contracts.Factory.abi,
    OnchainID.contracts.Factory.bytecode,
    deployer,
  ).deploy(await identityImplementationAuthority.getAddress());
  await identityFactory.waitForDeployment();

  const trexImplementationAuthority = await ethers.deployContract(
    'TREXImplementationAuthority',
    [true, ethers.ZeroAddress, ethers.ZeroAddress],
    deployer,
  );

  await trexImplementationAuthority.addAndUseTREXVersion(
    { major: 4, minor: 1, patch: 6 },
    {
      tokenImplementation: await tokenImpl.getAddress(),
      ctrImplementation: await claimTopicsRegistryImpl.getAddress(),
      irImplementation: await identityRegistryImpl.getAddress(),
      irsImplementation: await identityRegistryStorageImpl.getAddress(),
      tirImplementation: await trustedIssuersRegistryImpl.getAddress(),
      mcImplementation: await modularComplianceImpl.getAddress(),
    },
  );

  const trexFactory = await ethers.deployContract(
    'TREXFactory',
    [await trexImplementationAuthority.getAddress(), await identityFactory.getAddress()],
    deployer,
  );
  await (
    identityFactory.connect(deployer) as unknown as { addTokenFactory: (factory: string) => Promise<unknown> }
  ).addTokenFactory(await trexFactory.getAddress());

  const countryAllow = await deployModule('CountryAllowlistModule', 'ComplianceModuleProxy', deployer);
  const maxBalance = await deployModule('BalanceCapModule', 'ComplianceModuleProxy', deployer);
  const holderCountCap = await deployModule('HolderCountCapModule', 'ModuleProxy', deployer);
  const timeLockup = await deployModule('TimeLockupModule', 'ModuleProxy', deployer);
  const dailyMintCap = await deployModule('DailyMintCapModule', 'ComplianceModuleProxy', deployer);
  const countryAllowModule = countryAllow.module;
  const maxBalanceModule = maxBalance.module;
  const holderCountCapModule = holderCountCap.module;
  const timeLockupModule = timeLockup.module;
  const dailyMintCapModule = dailyMintCap.module;

  const countryAllowAddress = await countryAllowModule.getAddress();
  const countryChunks = chunkCountries(ALLOWED_COUNTRIES);

  await trexFactory.connect(deployer).deployTREXSuite(
    SUITE_SALT,
    {
      owner,
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      decimals: TOKEN_DECIMALS,
      irs: ethers.ZeroAddress,
      ONCHAINID: ethers.ZeroAddress,
      irAgents,
      tokenAgents,
      complianceModules: [
        ...countryChunks.map(() => countryAllowAddress),
        await maxBalanceModule.getAddress(),
        await holderCountCapModule.getAddress(),
        await timeLockupModule.getAddress(),
        await dailyMintCapModule.getAddress(),
      ],
      complianceSettings: [
        ...countryChunks.map((chunk) =>
          countryAllowModule.interface.encodeFunctionData('batchAllowCountries', [chunk]),
        ),
        maxBalanceModule.interface.encodeFunctionData('setMaxBalance', [MAX_BALANCE]),
        holderCountCapModule.interface.encodeFunctionData('setMaxHolderCount', [MAX_HOLDER_COUNT]),
        timeLockupModule.interface.encodeFunctionData('setLockupDuration', [lockupDuration]),
        dailyMintCapModule.interface.encodeFunctionData('setDailyMintCap', [DAILY_MINT_CAP]),
      ],
    },
    {
      claimTopics: REQUIRED_CLAIM_TOPICS,
      issuers: [claimIssuer],
      issuerClaims: [REQUIRED_CLAIM_TOPICS],
    },
  );

  const token = await ethers.getContractAt('Token', await trexFactory.getToken(SUITE_SALT));
  const identityRegistry = await ethers.getContractAt('IdentityRegistry', await token.identityRegistry());
  const compliance = await ethers.getContractAt('ModularCompliance', await token.compliance());
  const claimTopicsRegistry = await ethers.getContractAt(
    'ClaimTopicsRegistry',
    await identityRegistry.topicsRegistry(),
  );
  const trustedIssuersRegistry = await ethers.getContractAt(
    'TrustedIssuersRegistry',
    await identityRegistry.issuersRegistry(),
  );
  const identityRegistryStorage = await ethers.getContractAt(
    'IdentityRegistryStorage',
    await identityRegistry.identityStorage(),
  );

  return {
    token,
    identityRegistry,
    identityRegistryStorage,
    claimTopicsRegistry,
    trustedIssuersRegistry,
    compliance,
    countryAllowModule,
    maxBalanceModule,
    holderCountCapModule,
    timeLockupModule,
    dailyMintCapModule,
    trexFactory,
    trexImplementationAuthority,
    identityFactory,
    identityImplementationAuthority,
    implementations: {
      token: await tokenImpl.getAddress(),
      claimTopicsRegistry: await claimTopicsRegistryImpl.getAddress(),
      trustedIssuersRegistry: await trustedIssuersRegistryImpl.getAddress(),
      identityRegistry: await identityRegistryImpl.getAddress(),
      identityRegistryStorage: await identityRegistryStorageImpl.getAddress(),
      modularCompliance: await modularComplianceImpl.getAddress(),
      countryAllowlist: countryAllow.implementation,
      balanceCap: maxBalance.implementation,
      holderCountCap: holderCountCap.implementation,
      timeLockup: timeLockup.implementation,
      dailyMintCap: dailyMintCap.implementation,
    },
  };
}
