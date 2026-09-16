import { Contract, getAddress, type Signer } from 'ethers';

import { TOKEN_MINT_IFACE } from './forwarder';

export async function executeTokenMint(params: {
  signer: Signer;
  tokenAddress: string;
  to: string;
  amount: bigint;
}): Promise<string> {
  const token = new Contract(params.tokenAddress, TOKEN_MINT_IFACE, params.signer);
  const tx = await token.mint(params.to, params.amount);
  const receipt = await tx.wait();
  if (!receipt?.hash) {
    throw new Error('mint transaction mined without a hash');
  }
  return receipt.hash;
}
