import { Contract, ZeroAddress, getAddress } from 'ethers';

import { IDENTITY_REGISTRY_VIEW_ABI, TIME_LOCKUP_ABI, TOKEN_HOLDER_VIEW_ABI } from '../../../../config/abis.ts';
import type { PortfolioResponse } from '../../../../config/api.ts';

import type { ChainReader } from '../assets/catalog.ts';

const SECONDS_PER_DAY = 86_400n;

/**
 * One wallet's holding at a single block: balance and freezes from the token,
 * identity from the registry, and the exact lock-up tranches from the
 * TimeLockupModule. The tranches are the module's own records, so the unlock
 * dates shown are the ones transfers are checked against.
 */
export async function readPortfolio(input: {
  chain: ChainReader;
  chainId: number;
  tokenAddress: string;
  /** Unset leaves `lockup` null. */
  lockupModule?: string;
  walletAddress: string;
  now: Date;
}): Promise<PortfolioResponse> {
  const blockNumber = await input.chain.getBlockNumber();
  const at = { blockTag: blockNumber };
  const wallet = getAddress(input.walletAddress);

  const token = new Contract(input.tokenAddress, TOKEN_HOLDER_VIEW_ABI, input.chain);
  const [balance, frozen, frozenTokens, registryAddress, compliance] = await Promise.all([
    token.balanceOf(wallet, at) as Promise<bigint>,
    token.isFrozen(wallet, at) as Promise<boolean>,
    token.getFrozenTokens(wallet, at) as Promise<bigint>,
    token.identityRegistry(at) as Promise<string>,
    token.compliance(at) as Promise<string>,
  ]);

  const registry = new Contract(registryAddress, IDENTITY_REGISTRY_VIEW_ABI, input.chain);
  const identity = (await registry.identity(wallet, at)) as string;
  const identityAddress = identity === ZeroAddress ? null : getAddress(identity);

  let lockup: PortfolioResponse['lockup'] = null;
  if (identityAddress && input.lockupModule) {
    const module = new Contract(input.lockupModule, TIME_LOCKUP_ABI, input.chain);
    const [locked, spendable, duration, tranches] = await Promise.all([
      module.getLockedAmount(compliance, identityAddress, at) as Promise<bigint>,
      module.getSpendableAmount(compliance, identityAddress, at) as Promise<bigint>,
      module.getLockupDuration(compliance, at) as Promise<bigint>,
      module.getLockedTranches(compliance, identityAddress, at) as Promise<[bigint[], bigint[]]>,
    ]);
    const [amounts, releaseTimes] = tranches;
    lockup = {
      locked: locked.toString(),
      spendable: spendable.toString(),
      lockupDays: Number(duration / SECONDS_PER_DAY),
      tranches: amounts.map((amount, index) => ({
        amount: amount.toString(),
        releaseAt: new Date(Number(releaseTimes[index]) * 1000).toISOString(),
      })),
    };
  }

  return {
    ok: true,
    walletAddress: wallet,
    tokenAddress: getAddress(input.tokenAddress),
    chainId: input.chainId,
    blockNumber,
    readAt: input.now.toISOString(),
    balance: balance.toString(),
    frozen,
    frozenTokens: frozenTokens.toString(),
    identityAddress,
    lockup,
  };
}
