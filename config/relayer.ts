import { Contract, Interface, Signature, TypedDataEncoder, getAddress, verifyTypedData, type Signer } from 'ethers';

import {
  FORWARDER_IFACE,
  decodeEscrowDeposit,
  forwarderDomain,
  recoverForwardRequestSigner,
  toTypedForwardRequest,
  type ForwardRequest,
} from './forwarder';
import { APPROVE_SELECTOR, META_TRANSACTION_TYPES, usdtMetaDomain } from './usdtMetaTx';

export type RelayDepositInput = {
  request: ForwardRequest;
  signature: string;
};

export async function relayEscrowDeposit(params: {
  input: RelayDepositInput;
  escrowAddress: string;
  forwarderAddress: string;
  chainId: bigint;
  relayer: Signer;
  expectedFrom?: string;
}): Promise<{ txHash: string; intentId: string; amount: bigint }> {
  const request = toTypedForwardRequest(params.input.request);
  if (getAddress(request.to) !== getAddress(params.escrowAddress)) {
    throw new Error('forward request is not for the configured escrow');
  }

  const domain = forwarderDomain(params.chainId, params.forwarderAddress);
  const recovered = recoverForwardRequestSigner(domain, request, params.input.signature);
  if (recovered !== getAddress(request.from)) {
    throw new Error('forward request signature does not match from');
  }
  if (params.expectedFrom && recovered !== getAddress(params.expectedFrom)) {
    throw new Error('forward request signer does not match the quoted wallet');
  }

  const decoded = decodeEscrowDeposit(request.data);
  if (!decoded) {
    throw new Error('forward request data is not escrow deposit');
  }

  const forwarder = new Contract(params.forwarderAddress, FORWARDER_IFACE, params.relayer);
  const valid = await forwarder.verify(request, params.input.signature);
  if (!valid) {
    throw new Error('forwarder rejected the request');
  }

  const tx = await forwarder.execute(request, params.input.signature);
  const receipt = await tx.wait();
  if (!receipt?.hash) {
    throw new Error('relay transaction mined without a hash');
  }

  return { txHash: receipt.hash, intentId: decoded.intentId, amount: decoded.amount };
}

export const USDT_META_IFACE = new Interface([
  'function name() view returns (string)',
  'function getNonce(address user) view returns (uint256)',
  'function getDomainSeperator() view returns (bytes32)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function executeMetaTransaction(address userAddress, bytes functionSignature, bytes32 sigR, bytes32 sigS, uint8 sigV) payable returns (bytes)',
]);

/** ethers wants mutable arrays; the shared definition is readonly for viem. */
const META_TX_TYPES = { MetaTransaction: [...META_TRANSACTION_TYPES.MetaTransaction] };

/** A refused approval, with a stable code for the API response. */
export class RelayRefused extends Error {
  constructor(
    readonly code: 'not_escrow_approval' | 'domain_mismatch' | 'invalid_signature' | 'wrong_wallet',
    message: string,
  ) {
    super(message);
  }
}

export type RelayApprovalInput = {
  from: string;
  /** Calldata of approve(escrow, amount), signed inside the meta-transaction. */
  functionSignature: string;
  signature: string;
};

/**
 * Submits an investor's signed USDT approval for the escrow and pays its gas.
 * Only approve(escrow, amount) is relayed, so the relayer cannot be used to
 * move anyone's USDT or to spend gas on arbitrary calls. The EIP-712 domain
 * is rebuilt from the token's name and checked against the token's own
 * separator, so a token that signs differently is refused before any gas is
 * spent.
 */
export async function relayUsdtApproval(params: {
  input: RelayApprovalInput;
  usdtAddress: string;
  escrowAddress: string;
  chainId: bigint;
  relayer: Signer;
  expectedFrom?: string;
}): Promise<{ txHash: string; spender: string; amount: bigint }> {
  const from = getAddress(params.input.from);
  if (params.expectedFrom && from !== getAddress(params.expectedFrom)) {
    throw new RelayRefused('wrong_wallet', 'approval is not from the signed-in wallet');
  }

  const data = params.input.functionSignature;
  if (!data.toLowerCase().startsWith(APPROVE_SELECTOR)) {
    throw new RelayRefused('not_escrow_approval', 'only approve calls are relayed');
  }
  let spender: string;
  let amount: bigint;
  try {
    const decoded = USDT_META_IFACE.decodeFunctionData('approve', data);
    spender = getAddress(String(decoded.spender));
    amount = BigInt(decoded.amount);
  } catch {
    throw new RelayRefused('not_escrow_approval', 'approve calldata does not decode');
  }
  if (spender !== getAddress(params.escrowAddress)) {
    throw new RelayRefused('not_escrow_approval', 'approval spender is not the escrow');
  }

  const usdt = new Contract(params.usdtAddress, USDT_META_IFACE, params.relayer);
  const [name, nonce, separator] = (await Promise.all([
    usdt.name(),
    usdt.getNonce(from),
    usdt.getDomainSeperator(),
  ])) as [string, bigint, string];
  const domain = usdtMetaDomain({ name, verifyingContract: getAddress(params.usdtAddress), chainId: params.chainId });
  if (TypedDataEncoder.hashDomain(domain) !== separator) {
    throw new RelayRefused('domain_mismatch', 'token EIP-712 domain differs from the Polygon meta-transaction domain');
  }

  const message = { nonce, from, functionSignature: data };
  let recovered: string;
  try {
    recovered = getAddress(verifyTypedData(domain, META_TX_TYPES, message, params.input.signature));
  } catch {
    throw new RelayRefused('invalid_signature', 'signature does not decode');
  }
  if (recovered !== from) {
    throw new RelayRefused('invalid_signature', 'signature is not from the approving wallet');
  }

  const sig = Signature.from(params.input.signature);
  const tx = await usdt.executeMetaTransaction(from, data, sig.r, sig.s, sig.v);
  const receipt = await tx.wait();
  if (!receipt?.hash) {
    throw new Error('approval transaction mined without a hash');
  }
  return { txHash: receipt.hash, spender, amount };
}
