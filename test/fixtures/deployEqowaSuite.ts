import { ethers } from 'hardhat';
import OnchainID from '@onchain-id/solidity';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import type { BaseContract } from 'ethers';

import {
  COUNTRY,
  MAX_BALANCE,
  REQUIRED_CLAIM_TOPICS,
  TEST_ALLOWED_COUNTRIES,
  TOKEN_DECIMALS,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} from '../../config/eqowa';

/** Salt used by the factory's CREATE2 deployment of the EQOWAG suite. */
export const SUITE_SALT = 'eqowa-group-shares';

/** ERC-734 key purposes. 1 is management, 2 is action, 3 is claim signing. */
const KEY_PURPOSE_CLAIM_SIGNER = 3;
const KEY_TYPE_ECDSA = 1;

/** Deploys an ONCHAINID identity proxy controlled by `managementKey`. */
async function deployIdentityProxy(
  implementationAuthority: string,
  managementKey: string,
  signer: HardhatEthersSigner,
) {
  const factory = new ethers.ContractFactory(
    OnchainID.contracts.IdentityProxy.abi,
    OnchainID.contracts.IdentityProxy.bytecode,
    signer,
  );
  const proxy = await factory.deploy(implementationAuthority, managementKey);
  await proxy.waitForDeployment();

  return ethers.getContractAt('Identity', await proxy.getAddress());
}

/** Hashes an address the way ERC-734 expects keys to be stored. */
function addressKey(address: string): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address'], [address]));
}

/**
 * Signs a claim as the trusted issuer and writes it onto the investor's
 * identity. The digest format is fixed by ONCHAINID: keccak256 over the
 * encoded identity address, topic and data, signed as an eth_sign message.
 */
async function issueClaim(params: {
  identity: BaseContract;
  identityOwner: HardhatEthersSigner;
  claimIssuer: BaseContract;
  signingKey: { signMessage: (message: Uint8Array) => Promise<string> };
  topic: bigint;
}) {
  const { identity, identityOwner, claimIssuer, signingKey, topic } = params;

  const identityAddress = await identity.getAddress();
  const data = ethers.hexlify(ethers.toUtf8Bytes('Verified by Eqowa compliance.'));

  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'bytes'], [identityAddress, topic, data]),
  );
  const signature = await signingKey.signMessage(ethers.getBytes(digest));

  await (identity.connect(identityOwner) as any).addClaim(
    topic,
    1, // scheme: ECDSA
    await claimIssuer.getAddress(),
    signature,
    data,
    '',
  );
}

/**
 * Stands up the complete EQOWAG suite the same way production will: deploy the
 * implementations and the implementation authority, then let TREXFactory
 * create the token, registries and compliance in one call and hand ownership
 * to the Gnosis Safe.
 *
 * Investors are left with zero balance. Tests mint what they need, so that
 * lock-up behaviour stays under each test's control.
 */
export async function deployEqowaSuiteFixture() {
  const [deployer, safe, tokenAgent, claimIssuer, alice, bob, charlie, david, outsider] = await ethers.getSigners();

  // Off-chain key the issuer signs claims with. In production this lives in KMS.
  const claimIssuerSigningKey = ethers.Wallet.createRandom();

  // --- Implementations behind the T-REX proxies -----------------------------
  const claimTopicsRegistryImpl = await ethers.deployContract('ClaimTopicsRegistry', [], deployer);
  const trustedIssuersRegistryImpl = await ethers.deployContract('TrustedIssuersRegistry', [], deployer);
  const identityRegistryStorageImpl = await ethers.deployContract('IdentityRegistryStorage', [], deployer);
  const identityRegistryImpl = await ethers.deployContract('IdentityRegistry', [], deployer);
  const modularComplianceImpl = await ethers.deployContract('ModularCompliance', [], deployer);
  const tokenImpl = await ethers.deployContract('Token', [], deployer);

  // --- ONCHAINID infrastructure --------------------------------------------
  const identityImpl = await new ethers.ContractFactory(
    OnchainID.contracts.Identity.abi,
    OnchainID.contracts.Identity.bytecode,
    deployer,
  ).deploy(deployer.address, true);
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

  // --- T-REX implementation authority --------------------------------------
  // Owning this contract is what "owning the ProxyAdmin" means in T-REX: it is
  // the single switch that upgrades every proxy in the suite.
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

  // --- Suite factory --------------------------------------------------------
  const trexFactory = await ethers.deployContract(
    'TREXFactory',
    [await trexImplementationAuthority.getAddress(), await identityFactory.getAddress()],
    deployer,
  );
  await (identityFactory.connect(deployer) as any).addTokenFactory(await trexFactory.getAddress());

  // --- Trusted claim issuer -------------------------------------------------
  const claimIssuerContract = await ethers.deployContract('ClaimIssuer', [claimIssuer.address], claimIssuer);
  await claimIssuerContract
    .connect(claimIssuer)
    .addKey(addressKey(claimIssuerSigningKey.address), KEY_PURPOSE_CLAIM_SIGNER, KEY_TYPE_ECDSA);

  // --- Compliance modules ---------------------------------------------------
  // Modules are upgradeable, so each implementation sits behind a ModuleProxy
  // whose constructor runs initialize().
  const countryAllowImpl = await ethers.deployContract('CountryAllowModule', [], deployer);
  const countryAllowProxy = await ethers.deployContract(
    'ModuleProxy',
    [await countryAllowImpl.getAddress(), countryAllowImpl.interface.encodeFunctionData('initialize')],
    deployer,
  );
  const countryAllowModule = await ethers.getContractAt(
    'CountryAllowModule',
    await countryAllowProxy.getAddress(),
  );

  const maxBalanceImpl = await ethers.deployContract('MaxBalanceModule', [], deployer);
  const maxBalanceProxy = await ethers.deployContract(
    'ModuleProxy',
    [await maxBalanceImpl.getAddress(), maxBalanceImpl.interface.encodeFunctionData('initialize')],
    deployer,
  );
  const maxBalanceModule = await ethers.getContractAt('MaxBalanceModule', await maxBalanceProxy.getAddress());

  // --- Deploy the suite -----------------------------------------------------
  // The factory binds each module, applies its settings, then transfers
  // ownership of the token, both registries and the compliance to `owner`.
  await trexFactory.connect(deployer).deployTREXSuite(
    SUITE_SALT,
    {
      owner: safe.address,
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      decimals: TOKEN_DECIMALS,
      irs: ethers.ZeroAddress,
      ONCHAINID: ethers.ZeroAddress,
      irAgents: [tokenAgent.address],
      tokenAgents: [tokenAgent.address],
      complianceModules: [await countryAllowModule.getAddress(), await maxBalanceModule.getAddress()],
      complianceSettings: [
        countryAllowModule.interface.encodeFunctionData('batchAllowCountries', [TEST_ALLOWED_COUNTRIES]),
        maxBalanceModule.interface.encodeFunctionData('setMaxBalance', [MAX_BALANCE]),
      ],
    },
    {
      claimTopics: REQUIRED_CLAIM_TOPICS,
      issuers: [await claimIssuerContract.getAddress()],
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

  // --- Investor identities --------------------------------------------------
  // alice and bob are fully verified in allowed jurisdictions. david is
  // verified but resident in a blocked jurisdiction. charlie has no identity
  // at all, so he stands in for an unknown wallet.
  const identityAuthorityAddress = await identityImplementationAuthority.getAddress();
  const aliceIdentity = await deployIdentityProxy(identityAuthorityAddress, alice.address, deployer);
  const bobIdentity = await deployIdentityProxy(identityAuthorityAddress, bob.address, deployer);
  const davidIdentity = await deployIdentityProxy(identityAuthorityAddress, david.address, deployer);

  await identityRegistry
    .connect(tokenAgent)
    .batchRegisterIdentity(
      [alice.address, bob.address, david.address],
      [await aliceIdentity.getAddress(), await bobIdentity.getAddress(), await davidIdentity.getAddress()],
      [COUNTRY.NIGERIA, COUNTRY.UNITED_KINGDOM, COUNTRY.UNITED_STATES],
    );

  for (const [identity, identityOwner] of [
    [aliceIdentity, alice],
    [bobIdentity, bob],
    [davidIdentity, david],
  ] as const) {
    for (const topic of REQUIRED_CLAIM_TOPICS) {
      await issueClaim({
        identity,
        identityOwner,
        claimIssuer: claimIssuerContract,
        signingKey: claimIssuerSigningKey,
        topic,
      });
    }
  }

  // Tokens are deployed paused. Only an agent can lift that.
  await token.connect(tokenAgent).unpause();

  return {
    accounts: { deployer, safe, tokenAgent, claimIssuer, alice, bob, charlie, david, outsider },
    keys: { claimIssuerSigningKey },
    suite: {
      token,
      identityRegistry,
      identityRegistryStorage,
      claimTopicsRegistry,
      trustedIssuersRegistry,
      compliance,
      claimIssuerContract,
    },
    modules: { countryAllowModule, maxBalanceModule },
    identities: { aliceIdentity, bobIdentity, davidIdentity },
    infrastructure: {
      trexFactory,
      trexImplementationAuthority,
      identityFactory,
      identityImplementationAuthority,
    },
  };
}
