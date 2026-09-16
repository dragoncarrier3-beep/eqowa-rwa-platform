import { Contract, getAddress, type Signer } from 'ethers';

import {
  FORWARDER_IFACE,
  decodeEscrowDeposit,
  forwarderDomain,
  recoverForwardRequestSigner,
  toTypedForwardRequest,
  type ForwardRequest,
} from './forwarder';

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
