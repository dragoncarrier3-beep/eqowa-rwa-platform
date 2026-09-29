import { Contract, ZeroAddress, getAddress } from 'ethers';

import {
  CHECKOUT_USDT_ABI,
  COMPLIANCE_ABI,
  FORWARDER_ABI,
  IDENTITY_REGISTRY_ABI,
  TOKEN_HOLDER_VIEW_ABI,
} from '../../../../config/abis.ts';
import type { CheckoutBlocker, CheckoutResponse } from '../../../../config/api.ts';
import { splitUsdtDeposit, shareBaseUnits } from '../../../../config/eqowa.ts';

import type { ChainReader } from '../assets/catalog.ts';
import type { IdentityStore } from '../kyc/identityStore.ts';

export type CheckoutContracts = { token: string; usdt: string; escrow: string; forwarder: string };

/**
 * Pre-flight for one purchase, read at a single block. The eligibility checks
 * are the ones the token runs inside mint (isVerified, then canTransfer from
 * the zero address), so a purchase that passes here is not refused at mint
 * for identity or compliance reasons. Blockers are reported, not thrown: the
 * page shows every reason at once.
 */
export async function readCheckout(input: {
  chain: ChainReader;
  chainId: number;
  contracts: CheckoutContracts;
  identities: IdentityStore;
  walletAddress: string;
  usdtAmount: bigint;
}): Promise<CheckoutResponse> {
  const wallet = getAddress(input.walletAddress);
  const split = splitUsdtDeposit(input.usdtAmount);
  const shareAmount = shareBaseUnits(split.shares);
  const blockNumber = await input.chain.getBlockNumber();
  const at = { blockTag: blockNumber };

  const token = new Contract(input.contracts.token, TOKEN_HOLDER_VIEW_ABI, input.chain);
  const usdt = new Contract(input.contracts.usdt, CHECKOUT_USDT_ABI, input.chain);
  const forwarder = new Contract(input.contracts.forwarder, FORWARDER_ABI, input.chain);

  const [
    registryAddress,
    complianceAddress,
    usdtName,
    usdtBalance,
    allowance,
    usdtMetaNonce,
    forwarderNonce,
    identity,
  ] = await Promise.all([
    token.identityRegistry(at) as Promise<string>,
    token.compliance(at) as Promise<string>,
    usdt.name(at) as Promise<string>,
    usdt.balanceOf(wallet, at) as Promise<bigint>,
    usdt.allowance(wallet, input.contracts.escrow, at) as Promise<bigint>,
    usdt.getNonce(wallet, at) as Promise<bigint>,
    forwarder.getNonce(wallet, at) as Promise<bigint>,
    input.identities.getByWallet(wallet),
  ]);

  const registry = new Contract(registryAddress, IDENTITY_REGISTRY_ABI, input.chain);
  const compliance = new Contract(complianceAddress, COMPLIANCE_ABI, input.chain);
  const [identityVerified, compliant] = await Promise.all([
    registry.isVerified(wallet, at) as Promise<boolean>,
    // Zero shares is not a mint; skip the call rather than ask about 0.
    split.shares > 0n
      ? (compliance.canTransfer(ZeroAddress, wallet, shareAmount, at) as Promise<boolean>)
      : Promise.resolve(false),
  ]);

  const blockers: CheckoutBlocker[] = [];
  if (split.shares === 0n) {
    blockers.push('below_share_price');
  }
  if (identity?.kycStatus !== 'approved') {
    blockers.push('kyc_not_approved');
  }
  if (!identityVerified) {
    blockers.push('identity_not_verified');
  }
  if (split.shares > 0n && identityVerified && !compliant) {
    blockers.push('not_compliant');
  }
  if (usdtBalance < input.usdtAmount) {
    blockers.push('insufficient_usdt');
  }

  return {
    ok: true,
    walletAddress: wallet,
    chainId: input.chainId,
    blockNumber,
    usdtAmount: input.usdtAmount.toString(),
    shares: split.shares.toString(),
    shareAmount: shareAmount.toString(),
    fundsAmount: split.funds.toString(),
    feeAmount: split.fee.toString(),
    remainderAmount: split.remainder.toString(),
    kycStatus: identity?.kycStatus ?? null,
    identityVerified,
    compliant,
    usdtBalance: usdtBalance.toString(),
    allowance: allowance.toString(),
    needsApproval: allowance < input.usdtAmount,
    blockers,
    contracts: {
      usdt: getAddress(input.contracts.usdt),
      escrow: getAddress(input.contracts.escrow),
      forwarder: getAddress(input.contracts.forwarder),
    },
    usdtName,
    usdtMetaNonce: usdtMetaNonce.toString(),
    forwarderNonce: forwarderNonce.toString(),
  };
}
