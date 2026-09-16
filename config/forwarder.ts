import { Interface, getAddress, verifyTypedData } from 'ethers';

/** OpenZeppelin MinimalForwarder EIP-712 name and version. */
export const FORWARDER_NAME = 'MinimalForwarder';
export const FORWARDER_VERSION = '0.0.1';

export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
};

export type ForwardRequest = {
  from: string;
  to: string;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  data: string;
};

export const ESCROW_IFACE = new Interface(['function deposit(bytes32 intentId, uint256 amount)']);
export const TOKEN_MINT_IFACE = new Interface(['function mint(address _to, uint256 _amount)']);
export const FORWARDER_IFACE = new Interface([
  'function getNonce(address from) view returns (uint256)',
  'function verify((address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data) req, bytes signature) view returns (bool)',
  'function execute((address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data) req, bytes signature) payable returns (bool, bytes)',
]);

export function forwarderDomain(chainId: bigint | number, verifyingContract: string) {
  return {
    name: FORWARDER_NAME,
    version: FORWARDER_VERSION,
    chainId,
    verifyingContract: getAddress(verifyingContract),
  };
}

export function encodeEscrowDeposit(intentId: string, amount: bigint): string {
  return ESCROW_IFACE.encodeFunctionData('deposit', [intentId, amount]);
}

export function decodeEscrowDeposit(data: string): { intentId: string; amount: bigint } | null {
  try {
    const decoded = ESCROW_IFACE.decodeFunctionData('deposit', data);
    return { intentId: String(decoded.intentId), amount: BigInt(decoded.amount) };
  } catch {
    return null;
  }
}

export function recoverForwardRequestSigner(
  domain: ReturnType<typeof forwarderDomain>,
  request: ForwardRequest,
  signature: string,
): string {
  return getAddress(verifyTypedData(domain, FORWARD_REQUEST_TYPES, request, signature));
}

export function toTypedForwardRequest(request: ForwardRequest) {
  return {
    from: getAddress(request.from),
    to: getAddress(request.to),
    value: request.value,
    gas: request.gas,
    nonce: request.nonce,
    data: request.data,
  };
}
