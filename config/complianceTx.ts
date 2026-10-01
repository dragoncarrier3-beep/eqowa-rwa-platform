import { Interface, getAddress } from 'ethers';

import { ONE_SHARE } from './eqowa';

/**
 * Compliance rules are owned by the 2-of-3 Safe, not by the portal. The portal
 * prepares the change as a Safe Transaction Builder file; two signers import
 * it in the Safe app, check it and execute it. This file builds that call:
 * ModularCompliance.callModuleFunction(setterCalldata, module).
 */
export const COMPLIANCE_OWNER_IFACE = new Interface(['function callModuleFunction(bytes callData, address _module)']);

export const MODULE_SETTER_IFACE = new Interface([
  'function setMaxBalance(uint256 _max)',
  'function setMaxHolderCount(uint256 _max)',
  'function setDailyMintCap(uint256 _cap)',
  'function setLockupDuration(uint256 _duration)',
  'function batchAllowCountries(uint16[] _countries)',
  'function batchDisallowCountries(uint16[] _countries)',
]);

export type ComplianceModules = {
  balanceCap?: string;
  holderCountCap?: string;
  dailyMintCap?: string;
  timeLockup?: string;
  countryAllowlist?: string;
};

export type ComplianceChange =
  | { kind: 'maxBalance'; shares: bigint }
  | { kind: 'maxHolderCount'; holders: bigint }
  | { kind: 'dailyMintCap'; shares: bigint }
  | { kind: 'lockupDays'; days: bigint }
  | { kind: 'allowCountries'; countries: number[] }
  | { kind: 'disallowCountries'; countries: number[] };

const MODULE_FOR: Record<ComplianceChange['kind'], keyof ComplianceModules> = {
  maxBalance: 'balanceCap',
  maxHolderCount: 'holderCountCap',
  dailyMintCap: 'dailyMintCap',
  lockupDays: 'timeLockup',
  allowCountries: 'countryAllowlist',
  disallowCountries: 'countryAllowlist',
};

/** Plain words for the Safe app, so signers see what they are approving. */
export function describeChange(change: ComplianceChange): string {
  switch (change.kind) {
    case 'maxBalance':
      return `Set the per-investor holding limit to ${change.shares.toLocaleString('en-US')} shares`;
    case 'maxHolderCount':
      return `Set the maximum number of holders to ${change.holders.toLocaleString('en-US')}`;
    case 'dailyMintCap':
      return `Set the 24-hour issuance limit to ${change.shares.toLocaleString('en-US')} shares`;
    case 'lockupDays':
      return `Set the lock-up for new purchases to ${change.days} days`;
    case 'allowCountries':
      return `Allow countries ${change.countries.join(', ')}`;
    case 'disallowCountries':
      return `Block countries ${change.countries.join(', ')}`;
  }
}

export function encodeSetter(change: ComplianceChange): string {
  switch (change.kind) {
    case 'maxBalance':
      return MODULE_SETTER_IFACE.encodeFunctionData('setMaxBalance', [change.shares * ONE_SHARE]);
    case 'maxHolderCount':
      return MODULE_SETTER_IFACE.encodeFunctionData('setMaxHolderCount', [change.holders]);
    case 'dailyMintCap':
      return MODULE_SETTER_IFACE.encodeFunctionData('setDailyMintCap', [change.shares * ONE_SHARE]);
    case 'lockupDays':
      return MODULE_SETTER_IFACE.encodeFunctionData('setLockupDuration', [change.days * 86_400n]);
    case 'allowCountries':
      return MODULE_SETTER_IFACE.encodeFunctionData('batchAllowCountries', [change.countries]);
    case 'disallowCountries':
      return MODULE_SETTER_IFACE.encodeFunctionData('batchDisallowCountries', [change.countries]);
  }
}

/** The call the Safe makes on the compliance contract. */
export function complianceCall(change: ComplianceChange, modules: ComplianceModules): { module: string; data: string } {
  const module = modules[MODULE_FOR[change.kind]];
  if (!module) {
    throw new Error(`module for ${change.kind} is not configured`);
  }
  return {
    module: getAddress(module),
    data: COMPLIANCE_OWNER_IFACE.encodeFunctionData('callModuleFunction', [encodeSetter(change), getAddress(module)]),
  };
}

/**
 * Safe Transaction Builder batch file (format version 1.0): Safe app, Apps,
 * Transaction Builder, drag the file in, review, create batch, sign.
 */
export function safeBatchFile(input: {
  chainId: number;
  compliance: string;
  safe?: string;
  change: ComplianceChange;
  modules: ComplianceModules;
  createdAt: Date;
}) {
  const call = complianceCall(input.change, input.modules);
  return {
    version: '1.0',
    chainId: String(input.chainId),
    createdAt: input.createdAt.getTime(),
    meta: {
      name: 'EQOWA compliance change',
      description: describeChange(input.change),
      txBuilderVersion: '1.16.5',
      createdFromSafeAddress: input.safe ? getAddress(input.safe) : '',
      createdFromOwnerAddress: '',
    },
    transactions: [
      {
        to: getAddress(input.compliance),
        value: '0',
        data: call.data,
        contractMethod: null,
        contractInputsValues: null,
      },
    ],
  };
}
