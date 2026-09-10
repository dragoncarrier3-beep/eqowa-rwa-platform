import { ethers } from 'ethers';

import { TOKEN_DECIMALS, TOKEN_NAME, TOKEN_SYMBOL } from '../../config/eqowa';
import type { EqowaDeployment } from './deploymentFile';

export type VerificationTarget = {
  name: string;
  address: string;
  contract: string;
  args: unknown[];
};

const MODULE_INIT = new ethers.Interface(['function initialize()']).encodeFunctionData('initialize');

/** First-party and T-REX contracts we can verify from this repo. ONCHAINID stays unverified. */
export function verificationTargets(deployment: EqowaDeployment): VerificationTarget[] {
  const ia = deployment.trexImplementationAuthority;
  const impl = deployment.implementations;

  const targets: VerificationTarget[] = [
    {
      name: 'Token implementation',
      address: impl.token,
      contract: 'contracts/trex/token/Token.sol:Token',
      args: [],
    },
    {
      name: 'ClaimTopicsRegistry implementation',
      address: impl.claimTopicsRegistry,
      contract: 'contracts/trex/registry/implementation/ClaimTopicsRegistry.sol:ClaimTopicsRegistry',
      args: [],
    },
    {
      name: 'TrustedIssuersRegistry implementation',
      address: impl.trustedIssuersRegistry,
      contract: 'contracts/trex/registry/implementation/TrustedIssuersRegistry.sol:TrustedIssuersRegistry',
      args: [],
    },
    {
      name: 'IdentityRegistry implementation',
      address: impl.identityRegistry,
      contract: 'contracts/trex/registry/implementation/IdentityRegistry.sol:IdentityRegistry',
      args: [],
    },
    {
      name: 'IdentityRegistryStorage implementation',
      address: impl.identityRegistryStorage,
      contract: 'contracts/trex/registry/implementation/IdentityRegistryStorage.sol:IdentityRegistryStorage',
      args: [],
    },
    {
      name: 'ModularCompliance implementation',
      address: impl.modularCompliance,
      contract: 'contracts/trex/compliance/modular/ModularCompliance.sol:ModularCompliance',
      args: [],
    },
    {
      name: 'CountryAllowlistModule implementation',
      address: impl.countryAllowlist,
      contract: 'contracts/compliance/modules/CountryAllowlistModule.sol:CountryAllowlistModule',
      args: [],
    },
    {
      name: 'BalanceCapModule implementation',
      address: impl.balanceCap,
      contract: 'contracts/compliance/modules/BalanceCapModule.sol:BalanceCapModule',
      args: [],
    },
    {
      name: 'HolderCountCapModule implementation',
      address: impl.holderCountCap,
      contract: 'contracts/compliance/modules/HolderCountCapModule.sol:HolderCountCapModule',
      args: [],
    },
    {
      name: 'TimeLockupModule implementation',
      address: impl.timeLockup,
      contract: 'contracts/compliance/modules/TimeLockupModule.sol:TimeLockupModule',
      args: [],
    },
    {
      name: 'DailyMintCapModule implementation',
      address: impl.dailyMintCap,
      contract: 'contracts/compliance/modules/DailyMintCapModule.sol:DailyMintCapModule',
      args: [],
    },
    {
      name: 'TREXImplementationAuthority',
      address: ia,
      contract: 'contracts/trex/proxy/authority/TREXImplementationAuthority.sol:TREXImplementationAuthority',
      args: [true, ethers.ZeroAddress, ethers.ZeroAddress],
    },
    {
      name: 'TREXFactory',
      address: deployment.trexFactory,
      contract: 'contracts/trex/factory/TREXFactory.sol:TREXFactory',
      args: [ia, deployment.identityFactory],
    },
    {
      name: 'TokenProxy',
      address: deployment.token,
      contract: 'contracts/trex/proxy/TokenProxy.sol:TokenProxy',
      args: [
        ia,
        deployment.identityRegistry,
        deployment.compliance,
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_DECIMALS,
        ethers.ZeroAddress,
      ],
    },
    {
      name: 'IdentityRegistryProxy',
      address: deployment.identityRegistry,
      contract: 'contracts/trex/proxy/IdentityRegistryProxy.sol:IdentityRegistryProxy',
      args: [ia, deployment.trustedIssuersRegistry, deployment.claimTopicsRegistry, deployment.identityRegistryStorage],
    },
    {
      name: 'IdentityRegistryStorageProxy',
      address: deployment.identityRegistryStorage,
      contract: 'contracts/trex/proxy/IdentityRegistryStorageProxy.sol:IdentityRegistryStorageProxy',
      args: [ia],
    },
    {
      name: 'ClaimTopicsRegistryProxy',
      address: deployment.claimTopicsRegistry,
      contract: 'contracts/trex/proxy/ClaimTopicsRegistryProxy.sol:ClaimTopicsRegistryProxy',
      args: [ia],
    },
    {
      name: 'TrustedIssuersRegistryProxy',
      address: deployment.trustedIssuersRegistry,
      contract: 'contracts/trex/proxy/TrustedIssuersRegistryProxy.sol:TrustedIssuersRegistryProxy',
      args: [ia],
    },
    {
      name: 'ModularComplianceProxy',
      address: deployment.compliance,
      contract: 'contracts/trex/proxy/ModularComplianceProxy.sol:ModularComplianceProxy',
      args: [ia],
    },
    {
      name: 'CountryAllowlistModule proxy',
      address: deployment.modules.countryAllowlist,
      contract: 'contracts/compliance/ComplianceModuleProxy.sol:ComplianceModuleProxy',
      args: [impl.countryAllowlist, MODULE_INIT],
    },
    {
      name: 'BalanceCapModule proxy',
      address: deployment.modules.balanceCap,
      contract: 'contracts/compliance/ComplianceModuleProxy.sol:ComplianceModuleProxy',
      args: [impl.balanceCap, MODULE_INIT],
    },
    {
      name: 'HolderCountCapModule proxy',
      address: deployment.modules.holderCountCap,
      contract: 'contracts/trex/compliance/modular/modules/ModuleProxy.sol:ModuleProxy',
      args: [impl.holderCountCap, MODULE_INIT],
    },
    {
      name: 'TimeLockupModule proxy',
      address: deployment.modules.timeLockup,
      contract: 'contracts/trex/compliance/modular/modules/ModuleProxy.sol:ModuleProxy',
      args: [impl.timeLockup, MODULE_INIT],
    },
    {
      name: 'DailyMintCapModule proxy',
      address: deployment.modules.dailyMintCap,
      contract: 'contracts/compliance/ComplianceModuleProxy.sol:ComplianceModuleProxy',
      args: [impl.dailyMintCap, MODULE_INIT],
    },
  ];

  if (deployment.claimIssuerManagementKey) {
    targets.push({
      name: 'ClaimIssuer',
      address: deployment.claimIssuer,
      contract: '@onchain-id/solidity/contracts/ClaimIssuer.sol:ClaimIssuer',
      args: [deployment.claimIssuerManagementKey],
    });
  }

  return targets;
}
