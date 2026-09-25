import { Contract, type Signer } from 'ethers';

import { TOKEN_MINT_IFACE } from './forwarder';

export type MintCall = { to: string; shareAmount: bigint; intentId: string };

/** Outcome of a broadcast mint. `pending` means no receipt yet. */
export type MintReceiptStatus = 'success' | 'reverted' | 'pending';

/**
 * Agent mint split into broadcast and confirmation, so the pipeline can store
 * the transaction hash between the two. A crash after `send` then leaves a
 * hash to reconcile instead of an unknown mint that a retry would duplicate.
 */
export type MintExecutor = {
  /** Broadcasts `token.mint` and returns the hash once the node accepts it. */
  send(call: MintCall): Promise<string>;
  /** Waits for the receipt of a hash returned by `send`. */
  wait(txHash: string): Promise<MintReceiptStatus>;
};

function isCallException(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'CALL_EXCEPTION';
}

export function createTokenMintExecutor(params: { signer: Signer; tokenAddress: string }): MintExecutor {
  const token = new Contract(params.tokenAddress, TOKEN_MINT_IFACE, params.signer);

  return {
    async send(call) {
      const tx = await token.mint(call.to, call.shareAmount);
      return tx.hash as string;
    },
    async wait(txHash) {
      const provider = params.signer.provider;
      if (!provider) {
        throw new Error('agent signer has no provider');
      }
      // getTransaction().wait() rather than waitForTransaction(): both real
      // JSON-RPC providers and the Hardhat test provider implement it.
      const tx = await provider.getTransaction(txHash);
      if (!tx) {
        return 'pending';
      }
      try {
        const receipt = await tx.wait();
        if (!receipt) {
          return 'pending';
        }
        return receipt.status === 1 ? 'success' : 'reverted';
      } catch (error) {
        // ethers v6 throws CALL_EXCEPTION when the mined transaction reverted.
        if (isCallException(error)) {
          return 'reverted';
        }
        throw error;
      }
    },
  };
}

/** Send and wait in one call. Throws if the mint reverts. */
export async function executeTokenMint(params: {
  signer: Signer;
  tokenAddress: string;
  to: string;
  amount: bigint;
}): Promise<string> {
  const executor = createTokenMintExecutor({ signer: params.signer, tokenAddress: params.tokenAddress });
  const txHash = await executor.send({ to: params.to, shareAmount: params.amount, intentId: '' });
  const status = await executor.wait(txHash);
  if (status !== 'success') {
    throw new Error(`mint transaction ${txHash} ${status}`);
  }
  return txHash;
}
