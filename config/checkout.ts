/**
 * What the investor signs at checkout: the gasless USDT approval (Polygon
 * meta-transaction) and the gasless escrow deposit (ERC-2771 forward
 * request). Plain objects in the shape viem's signTypedData takes; ethers
 * signs the same values. No package imports, so the web app can use it
 * without ethers, and the call data is encoded by hand for the two fixed
 * signatures it needs.
 */

import { FORWARD_REQUEST_TYPES, FORWARDER_NAME, FORWARDER_VERSION } from './forwarderTypes';
import { APPROVE_SELECTOR, META_TRANSACTION_TYPES, usdtMetaDomain } from './usdtMetaTx';

type Hex = `0x${string}`;

/** keccak256("deposit(bytes32,uint256)")[0:4] on the escrow. */
export const DEPOSIT_SELECTOR = '0x1de26e16';

/** Gas the forwarder hands the escrow call. The relayer pays; this only caps it. */
export const DEPOSIT_GAS = 500_000n;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

function word(value: bigint): string {
  if (value < 0n || value >= 2n ** 256n) {
    throw new Error('value does not fit in uint256');
  }
  return value.toString(16).padStart(64, '0');
}

function addressWord(address: string): string {
  if (!ADDRESS.test(address)) {
    throw new Error(`not an address: ${address}`);
  }
  return address.slice(2).toLowerCase().padStart(64, '0');
}

export function encodeApproveCall(spender: string, amount: bigint): Hex {
  return `${APPROVE_SELECTOR}${addressWord(spender)}${word(amount)}`;
}

export function encodeDepositCall(intentId: string, amount: bigint): Hex {
  if (!BYTES32.test(intentId)) {
    throw new Error(`not a bytes32 intent id: ${intentId}`);
  }
  return `${DEPOSIT_SELECTOR}${intentId.slice(2).toLowerCase()}${word(amount)}`;
}

/** Approve exactly the quoted amount, never an open-ended allowance. */
export function approvalTypedData(input: {
  chainId: number;
  usdt: string;
  usdtName: string;
  escrow: string;
  from: string;
  nonce: bigint;
  amount: bigint;
}) {
  return {
    domain: usdtMetaDomain({ name: input.usdtName, verifyingContract: input.usdt, chainId: input.chainId }),
    types: META_TRANSACTION_TYPES,
    primaryType: 'MetaTransaction' as const,
    message: {
      nonce: input.nonce,
      from: input.from as Hex,
      functionSignature: encodeApproveCall(input.escrow, input.amount),
    },
  };
}

export function depositTypedData(input: {
  chainId: number;
  forwarder: string;
  escrow: string;
  from: string;
  nonce: bigint;
  intentId: string;
  amount: bigint;
}) {
  return {
    domain: {
      name: FORWARDER_NAME,
      version: FORWARDER_VERSION,
      chainId: input.chainId,
      verifyingContract: input.forwarder as Hex,
    },
    types: FORWARD_REQUEST_TYPES,
    primaryType: 'ForwardRequest' as const,
    message: {
      from: input.from as Hex,
      to: input.escrow as Hex,
      value: 0n,
      gas: DEPOSIT_GAS,
      nonce: input.nonce,
      data: encodeDepositCall(input.intentId, input.amount),
    },
  };
}
