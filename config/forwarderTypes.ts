/**
 * EIP-712 definition of the ERC-2771 forward request behind gasless escrow
 * deposits. No imports, so the web app (viem) and the API (ethers) share it.
 * config/forwarder.ts re-exports these next to its ethers helpers.
 */

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
} as const;
