import { ethers } from 'hardhat';
import OnchainID from '@onchain-id/solidity';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import type { BaseContract } from 'ethers';

import { COUNTRY, REQUIRED_CLAIM_TOPICS } from '../../config/eqowa';
import { deployEqowaContracts, SUITE_SALT } from '../../scripts/lib/deployEqowaContracts';

export { SUITE_SALT };

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

  // --- Trusted claim issuer -------------------------------------------------
  const claimIssuerContract = await ethers.deployContract('ClaimIssuer', [claimIssuer.address], claimIssuer);
  await claimIssuerContract
    .connect(claimIssuer)
    .addKey(addressKey(claimIssuerSigningKey.address), KEY_PURPOSE_CLAIM_SIGNER, KEY_TYPE_ECDSA);

  // Same factory path the Amoy deploy script uses, including all five modules.
  const deployed = await deployEqowaContracts({
    deployer,
    owner: safe.address,
    agent: tokenAgent.address,
    claimIssuer: await claimIssuerContract.getAddress(),
    // Tests mint and transfer in the same block. Production deploy uses 730 days.
    lockupDuration: 0n,
  });

  const {
    token,
    identityRegistry,
    identityRegistryStorage,
    claimTopicsRegistry,
    trustedIssuersRegistry,
    compliance,
    countryAllowModule,
    maxBalanceModule,
    trexFactory,
    trexImplementationAuthority,
    identityFactory,
    identityImplementationAuthority,
  } = deployed;

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
    modules: {
      countryAllowModule,
      maxBalanceModule,
      holderCountCapModule: deployed.holderCountCapModule,
      timeLockupModule: deployed.timeLockupModule,
      dailyMintCapModule: deployed.dailyMintCapModule,
    },
    identities: { aliceIdentity, bobIdentity, davidIdentity },
    infrastructure: {
      trexFactory,
      trexImplementationAuthority,
      identityFactory,
      identityImplementationAuthority,
    },
  };
}
