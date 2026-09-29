import assert from 'node:assert/strict';
import test from 'node:test';

import { Wallet, verifyTypedData } from 'ethers';
import { privateKeyToAccount } from 'viem/accounts';

import { approvalTypedData, depositTypedData } from '../../../../config/checkout.ts';

// Hardhat's well-known first test key.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const viemAccount = privateKeyToAccount(KEY);
const ethersWallet = new Wallet(KEY);

const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const ESCROW = '0x2222222222222222222222222222222222222222';
const FORWARDER = '0x3333333333333333333333333333333333333333';

function mutable(types: Record<string, readonly { name: string; type: string }[]>) {
  return Object.fromEntries(Object.entries(types).map(([key, fields]) => [key, [...fields]]));
}

/**
 * The web app signs with viem, the relayer verifies with ethers. Both must
 * hash the typed data identically, including Polygon's salt domain, or every
 * checkout would be refused as invalid_signature.
 */
test('viem and ethers produce the same approval signature', async () => {
  const typed = approvalTypedData({
    chainId: 137,
    usdt: USDT,
    usdtName: '(PoS) Tether USD',
    escrow: ESCROW,
    from: viemAccount.address,
    nonce: 3n,
    amount: 25_000_000n,
  });

  const fromViem = await viemAccount.signTypedData(typed);
  const fromEthers = await ethersWallet.signTypedData(typed.domain, mutable(typed.types), typed.message);

  assert.equal(fromViem, fromEthers);
  assert.equal(verifyTypedData(typed.domain, mutable(typed.types), typed.message, fromViem), viemAccount.address);
});

test('viem and ethers produce the same deposit signature', async () => {
  const typed = depositTypedData({
    chainId: 80002,
    forwarder: FORWARDER,
    escrow: ESCROW,
    from: viemAccount.address,
    nonce: 0n,
    intentId: `0x${'ab'.repeat(32)}`,
    amount: 10_000_000n,
  });

  const fromViem = await viemAccount.signTypedData(typed);
  const fromEthers = await ethersWallet.signTypedData(typed.domain, mutable(typed.types), typed.message);

  assert.equal(fromViem, fromEthers);
});
