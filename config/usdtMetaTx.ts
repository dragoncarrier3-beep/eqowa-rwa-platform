/**
 * Polygon PoS meta-transactions on USDT, used to approve the escrow without
 * the investor paying gas. The investor signs this EIP-712 message; the
 * relayer submits `executeMetaTransaction`. No imports, so the web app (viem)
 * and the API (ethers) share the exact same definition.
 *
 * Polygon's EIP712Base puts the chain id in `salt` (bytes32) and has no
 * `chainId` field. Wallets and both libraries order the domain fields as
 * name, version, verifyingContract, salt, which matches the contract.
 */

export const USDT_META_VERSION = '1';

export const META_TRANSACTION_TYPES = {
  MetaTransaction: [
    { name: 'nonce', type: 'uint256' },
    { name: 'from', type: 'address' },
    { name: 'functionSignature', type: 'bytes' },
  ],
} as const;

/** ERC-20 approve(address,uint256) selector. The relayer submits nothing else. */
export const APPROVE_SELECTOR = '0x095ea7b3';

/** The chain id as the bytes32 salt Polygon uses. */
export function chainIdSalt(chainId: number | bigint): `0x${string}` {
  return `0x${BigInt(chainId).toString(16).padStart(64, '0')}`;
}

/** `name` is the token's own name(), for example "(PoS) Tether USD" on Polygon. */
export function usdtMetaDomain(input: { name: string; verifyingContract: string; chainId: number | bigint }) {
  return {
    name: input.name,
    version: USDT_META_VERSION,
    verifyingContract: input.verifyingContract as `0x${string}`,
    salt: chainIdSalt(input.chainId),
  };
}
