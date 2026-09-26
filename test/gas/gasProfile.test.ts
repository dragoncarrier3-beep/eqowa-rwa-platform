import { mkdir, writeFile } from 'node:fs/promises';

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import type { ContractTransactionResponse } from 'ethers';

import { AMOY_GAS_PRICE_WEI } from '../../config/amoyFees';
import { COUNTRY, LOCKUP_DURATION_SECONDS, ONE_USDT, REQUIRED_CLAIM_TOPICS, shareBaseUnits } from '../../config/eqowa';
import { encodeEscrowDeposit, FORWARD_REQUEST_TYPES, forwarderDomain } from '../../config/forwarder';
import { deploySettlementContracts } from '../../scripts/lib/deploySettlementContracts';
import { deployIdentityProxy, issueClaim } from '../fixtures/deployEqowaSuite';
import { deployFullRulesFixture } from '../fixtures/deployFullRules';

/**
 * Gas for the operations the platform runs in production, measured from
 * receipts under the production rules (all five modules, 730-day lock-up).
 * The generic gas reporter misattributes calls made through T-REX proxies, so
 * these numbers are the ones docs/GAS.md quotes. Each has a ceiling so a
 * change that makes an everyday operation much more expensive fails CI.
 */
// Measured on 26 September 2026, plus about 15 percent headroom.
const CEILINGS: Record<string, bigint> = {
  identityProxyDeploy: 435_000n, // measured 378,639
  addClaim: 350_000n, // measured 304,914
  registerIdentity: 95_000n, // measured 79,578
  mintFirstTranche: 740_000n, // measured 642,082
  mintTopUp: 590_000n, // measured 510,565
  transferAfterLockup: 600_000n, // measured 520,283
  forcedTransferLocked: 665_000n, // measured 577,393
  escrowDeposit: 155_000n, // measured 132,463
  relayedDeposit: 165_000n, // measured 141,979
};

/** Gas of the last transaction mined, for helpers that do not return a receipt. */
async function lastTxGas() {
  const block = await ethers.provider.getBlock('latest');
  const hash = block!.transactions[block!.transactions.length - 1]!;
  return (await ethers.provider.getTransactionReceipt(hash))!.gasUsed;
}

async function gasOf(tx: Promise<ContractTransactionResponse> | ContractTransactionResponse) {
  const receipt = await (await tx).wait();
  return receipt!.gasUsed;
}

describe('gas profile', () => {
  it('measures the everyday operations and keeps them under their ceilings', async () => {
    const { accounts, keys, suite, infrastructure } = await loadFixture(deployFullRulesFixture);
    const { token, identityRegistry, claimIssuerContract } = suite;
    const { tokenAgent, alice, bob, outsider, deployer, safe } = accounts;
    const measured: Record<string, bigint> = {};

    // Onboarding a new investor: identity, two claims, registration.
    const investor = ethers.Wallet.createRandom().connect(ethers.provider);
    const identity = await deployIdentityProxy(
      await infrastructure.identityImplementationAuthority.getAddress(),
      outsider.address,
      outsider,
    );
    measured.identityProxyDeploy = await lastTxGas();
    await issueClaim({
      identity,
      identityOwner: outsider,
      claimIssuer: claimIssuerContract,
      signingKey: keys.claimIssuerSigningKey,
      topic: REQUIRED_CLAIM_TOPICS[0]!,
    });
    measured.addClaim = await lastTxGas();
    await issueClaim({
      identity,
      identityOwner: outsider,
      claimIssuer: claimIssuerContract,
      signingKey: keys.claimIssuerSigningKey,
      topic: REQUIRED_CLAIM_TOPICS[1]!,
    });
    measured.registerIdentity = await gasOf(
      identityRegistry
        .connect(tokenAgent)
        .registerIdentity(investor.address, await identity.getAddress(), COUNTRY.GHANA),
    );

    // Issuance: a new holder's first tranche costs more than a top-up.
    measured.mintFirstTranche = await gasOf(token.connect(tokenAgent).mint(alice.address, shareBaseUnits(100n)));
    measured.mintTopUp = await gasOf(token.connect(tokenAgent).mint(alice.address, shareBaseUnits(50n)));

    // Agent moving locked shares, with the lock carried to the recipient.
    measured.forcedTransferLocked = await gasOf(
      token.connect(tokenAgent).forcedTransfer(alice.address, bob.address, shareBaseUnits(10n)),
    );

    // Investor transfer once the 730 days have run.
    await time.increase(Number(LOCKUP_DURATION_SECONDS) + 1);
    measured.transferAfterLockup = await gasOf(token.connect(alice).transfer(bob.address, shareBaseUnits(20n)));

    // Payment: direct escrow deposit, and the relayer's cost for a gasless one.
    const { usdt, forwarder, escrow } = await deploySettlementContracts({ deployer, owner: safe.address });
    const escrowAddress = await escrow.getAddress();
    await usdt.mint(alice.address, 20n * ONE_USDT);
    await usdt.connect(alice).approve(escrowAddress, 20n * ONE_USDT);
    measured.escrowDeposit = await gasOf(escrow.connect(alice).deposit(ethers.id('direct'), 10n * ONE_USDT));

    const request = {
      from: alice.address,
      to: escrowAddress,
      value: 0n,
      gas: 500_000n,
      nonce: await forwarder.getNonce(alice.address),
      data: encodeEscrowDeposit(ethers.id('relayed'), 10n * ONE_USDT),
    };
    const { chainId } = await ethers.provider.getNetwork();
    const signature = await alice.signTypedData(
      forwarderDomain(chainId, await forwarder.getAddress()),
      FORWARD_REQUEST_TYPES,
      request,
    );
    measured.relayedDeposit = await gasOf(forwarder.connect(deployer).execute(request, signature));

    const rows = Object.entries(measured).map(([operation, gas]) => ({
      operation,
      gas: Number(gas),
      polAtPinnedPrice: ethers.formatEther(gas * AMOY_GAS_PRICE_WEI),
    }));
    await mkdir('reports', { recursive: true });
    await writeFile('reports/gas-profile.json', `${JSON.stringify(rows, null, 2)}\n`);
    console.table(rows);

    for (const [operation, gas] of Object.entries(measured)) {
      expect(gas, operation).to.be.lessThanOrEqual(CEILINGS[operation]!);
    }
  });
});
