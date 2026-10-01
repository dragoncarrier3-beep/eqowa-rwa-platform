import { Contract, Interface, getAddress, type Signer } from 'ethers';

/**
 * Agent-only token actions the admin portal triggers. Freeze and pause read
 * the current state first and send nothing when it already holds, so a double
 * click or a retry never produces a second transaction. Mint and burn move
 * balances and always send; the portal requires a reason and audits them.
 */
export const TOKEN_CONTROL_IFACE = new Interface([
  'function isFrozen(address _userAddress) view returns (bool)',
  'function setAddressFrozen(address _userAddress, bool _freeze)',
  'function paused() view returns (bool)',
  'function pause()',
  'function unpause()',
  'function mint(address _to, uint256 _amount)',
  'function burn(address _userAddress, uint256 _amount)',
]);

export type ControlResult = { changed: true; txHash: string } | { changed: false };

async function send(tx: { wait(): Promise<{ status: number | null; hash: string } | null> }, what: string) {
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${what} transaction reverted`);
  }
  return receipt.hash;
}

/** Freezes or unfreezes a whole wallet: a frozen wallet can neither send nor receive. */
export async function setWalletFrozen(params: {
  signer: Signer;
  tokenAddress: string;
  wallet: string;
  frozen: boolean;
}): Promise<ControlResult> {
  const wallet = getAddress(params.wallet);
  const token = new Contract(params.tokenAddress, TOKEN_CONTROL_IFACE, params.signer);
  if ((await token.isFrozen(wallet)) === params.frozen) {
    return { changed: false };
  }
  return { changed: true, txHash: await send(await token.setAddressFrozen(wallet, params.frozen), 'freeze') };
}

/** Pauses or resumes all transfers of the token. Minting is unaffected by pause in T-REX. */
export async function setTokenPaused(params: {
  signer: Signer;
  tokenAddress: string;
  paused: boolean;
}): Promise<ControlResult> {
  const token = new Contract(params.tokenAddress, TOKEN_CONTROL_IFACE, params.signer);
  if ((await token.paused()) === params.paused) {
    return { changed: false };
  }
  const tx = params.paused ? await token.pause() : await token.unpause();
  return { changed: true, txHash: await send(tx, params.paused ? 'pause' : 'unpause') };
}

/**
 * Mints outside the payment pipeline, for corrections and allocations agreed
 * off-platform. Identity, compliance, the balance cap and the daily cap are
 * still enforced by the token, so the chain refuses anything the rules forbid.
 */
export async function agentMint(params: { signer: Signer; tokenAddress: string; wallet: string; amount: bigint }) {
  const token = new Contract(params.tokenAddress, TOKEN_CONTROL_IFACE, params.signer);
  return send(await token.mint(getAddress(params.wallet), params.amount), 'mint');
}

/** Burns from a wallet, for redemptions and corrections. */
export async function agentBurn(params: { signer: Signer; tokenAddress: string; wallet: string; amount: bigint }) {
  const token = new Contract(params.tokenAddress, TOKEN_CONTROL_IFACE, params.signer);
  return send(await token.burn(getAddress(params.wallet), params.amount), 'burn');
}
