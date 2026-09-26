import {
  Contract,
  ContractFactory,
  MaxUint256,
  formatEther,
  formatUnits,
  getAddress,
  id,
  type TransactionResponse,
} from 'ethers';
import OnchainID from '@onchain-id/solidity';

import { CLAIM_DATA, CLAIM_SCHEME_ECDSA, signClaim } from '../../../../config/claims.ts';
import { decodeRevert } from '../../../../config/errors.ts';
import { COUNTRY, ONE_SHARE, ONE_USDT, REQUIRED_CLAIM_TOPICS, TOKEN_DECIMALS } from '../../../../config/eqowa.ts';
import { encodeEscrowDeposit, FORWARD_REQUEST_TYPES, forwarderDomain } from '../../../../config/forwarder.ts';
import { QUOTE_TTL_SECONDS } from '../../../../config/mint.ts';

import { applySumsubWebhook } from '../kyc/applyKyc.ts';
import { MemoryIdentityStore } from '../kyc/identityStore.ts';
import { MemoryMintStore } from '../mint/mintStore.ts';
import { approveSafeMint, createMintQuote } from '../mint/pipeline.ts';
import { relayEscrowDeposit } from '../relayer/relayDeposit.ts';
import { MemorySyncStateStore } from '../settlement/syncState.ts';
import { createSettlementWorker } from '../settlement/worker.ts';
import { createTokenMintExecutor } from '../signer/executeMint.ts';

import {
  CLAIM_ISSUER_ABI,
  COMPLIANCE_ABI,
  ESCROW_ABI,
  FORWARDER_ABI,
  IDENTITY_ABI,
  IDENTITY_REGISTRY_ABI,
  MOCK_USDT_ABI,
  MODULE_ABI,
  TOKEN_ABI,
} from './abis.ts';
import { addressKey, loadDeployment, type SimContext } from './context.ts';

export type StepResult = {
  id: string;
  title: string;
  expected: string;
  actual: string;
  pass: boolean;
  txs: string[];
};

export type SimulationResult = {
  network: string;
  chainId: number;
  runId: string;
  startedAt: string;
  finishedAt: string;
  contracts: Record<string, string>;
  wallets: Record<string, string>;
  steps: StepResult[];
  passed: number;
  failed: number;
};

/** Evidence the simulation uses in place of a real Safe transaction. Labelled as such in the report. */
export const SIMULATED_SAFE_TX = id('eqowa-m3-simulation-safe-approval');

const shares = (amount: bigint) => formatUnits(amount, TOKEN_DECIMALS);
const usdt = (whole: bigint) => whole * ONE_USDT;

function reason(error: unknown): string {
  const revert = decodeRevert(error);
  return revert.source === 'unknown' ? revert.message : `${revert.code} (${revert.message})`;
}

/**
 * Runs the whole Milestone 3 lifecycle against a deployed suite and escrow,
 * using the production webhook handler, pipeline, settlement worker and agent
 * mint executor. Every step records what was expected, what happened and the
 * transactions behind it.
 */
export async function runScenario(ctx: SimContext, log: (line: string) => void = () => {}): Promise<SimulationResult> {
  const startedAt = new Date().toISOString();
  const deployment = await loadDeployment(ctx.network);
  const { settlement } = deployment;
  const { alice, david, charlie } = ctx.investors;
  const steps: StepResult[] = [];

  const token = new Contract(deployment.token, TOKEN_ABI, ctx.agent);
  const registry = new Contract(deployment.identityRegistry, IDENTITY_REGISTRY_ABI, ctx.agent);
  const claimIssuer = new Contract(deployment.claimIssuer, CLAIM_ISSUER_ABI, ctx.provider);
  const compliance = new Contract(deployment.compliance, COMPLIANCE_ABI, ctx.provider);
  const countryModule = new Contract(deployment.modules.countryAllowlist, MODULE_ABI, ctx.provider);
  const lockupModule = new Contract(deployment.modules.timeLockup, MODULE_ABI, ctx.provider);
  const mockUsdt = new Contract(settlement.usdt, MOCK_USDT_ABI, ctx.operator);
  const escrow = new Contract(settlement.escrow, ESCROW_ABI, ctx.provider);
  const forwarder = new Contract(settlement.forwarder, FORWARDER_ABI, ctx.provider);

  const identities = new MemoryIdentityStore();
  const mintStore = new MemoryMintStore();
  const worker = createSettlementWorker({
    chain: ctx.provider,
    escrowAddress: settlement.escrow,
    usdtAddress: settlement.usdt,
    indexFromBlock: settlement.escrowDeployBlock,
    mintStore,
    identities,
    syncStore: new MemorySyncStateStore(),
    mint: createTokenMintExecutor({ signer: ctx.agent, tokenAddress: deployment.token }),
    log: { info() {}, warn() {}, error: (entry: unknown) => log(`worker error ${JSON.stringify(entry)}`) },
  });

  async function sent(tx: TransactionResponse, txs: string[]) {
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`transaction ${tx.hash} failed`);
    }
    txs.push(tx.hash);
    return receipt;
  }

  async function step(
    id: string,
    title: string,
    expected: string,
    run: (txs: string[]) => Promise<{ actual: string; pass: boolean }>,
  ) {
    const txs: string[] = [];
    let result: StepResult;
    try {
      const outcome = await run(txs);
      result = { id, title, expected, ...outcome, txs };
    } catch (error) {
      result = { id, title, expected, actual: `error: ${reason(error)}`, pass: false, txs };
    }
    steps.push(result);
    log(`${result.pass ? 'PASS' : 'FAIL'} ${id} ${title}: ${result.actual}`);
    return result;
  }

  /** Ticks the worker, moving the chain forward, until `done` holds or rounds run out. */
  async function settleUntil(done: () => Promise<boolean>) {
    for (let round = 0; round < ctx.maxRounds; round += 1) {
      await ctx.advance();
      const tick = await worker.tick();
      log(
        `  tick ${round + 1}: head ${tick.head}, scanned to ${tick.scannedTo ?? '-'}, deposits ${tick.depositsRecorded}, ` +
          `mints ${tick.mintsSent}/${tick.mintsConfirmed}, exceptions ${tick.exceptionsOpened}, errors ${tick.errors}`,
      );
      if (await done()) {
        return true;
      }
    }
    return false;
  }

  const statusOf = async (intentId: string) => (await mintStore.getQuote(intentId))?.status;
  const exceptionKinds = async (intentId: string) =>
    (await mintStore.listExceptions({ intentId })).map((row) => row.kind);

  // ------------------------------------------------------------------ setup
  await step(
    'S01',
    'Preflight',
    'Chain matches the deployment, agent key is the token agent, operator can sign KYC claims',
    async () => {
      const { chainId } = await ctx.provider.getNetwork();
      const agentOk = ctx.agentWallet.address === getAddress(deployment.agent);
      const issuerOk = await claimIssuer.keyHasPurpose(addressKey(ctx.operatorWallet.address), 3);
      const chainOk = Number(chainId) === deployment.chainId;
      return {
        actual: `chain ${chainId}, agent ${agentOk ? 'matches' : 'MISMATCH'}, claim signer ${issuerOk ? 'yes' : 'NO'}`,
        pass: chainOk && agentOk && Boolean(issuerOk),
      };
    },
  );

  await step('S02', 'Fund test wallets', 'Investors and the agent can pay gas', async (txs) => {
    for (const target of [alice, david]) {
      const balance = await ctx.provider.getBalance(target.address);
      if (balance < ctx.investorGas) {
        await sent(await ctx.operator.sendTransaction({ to: target.address, value: ctx.investorGas - balance }), txs);
      }
    }
    const agentBalance = await ctx.provider.getBalance(ctx.agentWallet.address);
    if (agentBalance < ctx.agentGasFloor) {
      await sent(await ctx.operator.sendTransaction({ to: ctx.agentWallet.address, value: ctx.agentGasFloor }), txs);
    }
    const agentNow = await ctx.provider.getBalance(ctx.agentWallet.address);
    return { actual: `agent holds ${formatEther(agentNow)} POL`, pass: agentNow >= ctx.agentGasFloor };
  });

  // --------------------------------------------------------------- identities
  async function registerInvestor(address: string, country: number, txs: string[]) {
    const factory = new ContractFactory(
      OnchainID.contracts.IdentityProxy.abi,
      OnchainID.contracts.IdentityProxy.bytecode,
      ctx.operator,
    );
    const proxy = await factory.deploy(deployment.identityImplementationAuthority, ctx.operatorWallet.address);
    await sent(proxy.deploymentTransaction()!, txs);
    const identityAddress = await proxy.getAddress();
    const identity = new Contract(identityAddress, IDENTITY_ABI, ctx.operator);
    for (const topic of REQUIRED_CLAIM_TOPICS) {
      const signature = await signClaim(ctx.operatorWallet, identityAddress, topic);
      await sent(
        await identity.addClaim(topic, CLAIM_SCHEME_ECDSA, deployment.claimIssuer, signature, CLAIM_DATA, ''),
        txs,
      );
    }
    await sent(await registry.registerIdentity(address, identityAddress, country), txs);
    return identityAddress;
  }

  await step(
    'S03',
    'Register Alice (Nigeria)',
    'ONCHAINID with claims 1 and 2, verified in the registry',
    async (txs) => {
      await registerInvestor(alice.address, COUNTRY.NIGERIA, txs);
      const verified = await registry.isVerified(alice.address);
      return { actual: `isVerified = ${verified}`, pass: verified === true };
    },
  );

  await step(
    'S04',
    'Register David (United States)',
    'Verified identity, so any later block comes from compliance, not identity',
    async (txs) => {
      await registerInvestor(david.address, COUNTRY.UNITED_STATES, txs);
      const verified = await registry.isVerified(david.address);
      return { actual: `isVerified = ${verified}`, pass: verified === true };
    },
  );

  await step('S05', 'Charlie has no identity', 'Not verified', async () => {
    const verified = await registry.isVerified(charlie.address);
    return { actual: `isVerified = ${verified}`, pass: verified === false };
  });

  // ---------------------------------------------------------------------- KYC
  const webhook = (applicantId: string, wallet: string, country: string) =>
    applySumsubWebhook({
      payload: {
        type: 'applicantReviewed',
        applicantId,
        externalUserId: wallet,
        reviewResult: { reviewAnswer: 'GREEN' },
        info: { country },
      },
      store: identities,
    });

  await step('S06', 'Sumsub GREEN for Alice (NGA)', 'KYC approved with claims 1 and 2', async () => {
    const result = await webhook(`sim-${ctx.runId}-alice`, alice.address, 'NGA');
    return {
      actual: `${result.status}, claims ${JSON.stringify(result.identity?.claims ?? [])}`,
      pass: result.status === 'approved',
    };
  });

  await step('S07', 'Sumsub GREEN for David (USA)', 'Rejected: United States is not on the allow-list', async () => {
    const result = await webhook(`sim-${ctx.runId}-david`, david.address, 'USA');
    return { actual: `${result.status} (${result.reason})`, pass: result.status === 'rejected' };
  });

  // ------------------------------------------------------------------- quotes
  async function quote(wallet: string, wholeUsdt: bigint, now: Date = new Date()) {
    const created = await createMintQuote({
      input: { wallet, usdtAmount: usdt(wholeUsdt).toString() },
      store: mintStore,
      now,
    });
    if ('error' in created) {
      throw new Error(created.error);
    }
    return created.quote;
  }

  let happy = '';
  await step('S08', 'Quote 10 USDT for Alice', '2 shares, 8 USDT funds, 2 USDT fee, 15-minute expiry', async () => {
    const q = await quote(alice.address, 10n);
    happy = q.intentId;
    const minutes = (Date.parse(q.quoteExpiresAt) - Date.now()) / 60_000;
    return {
      actual: `${q.shares} shares, funds ${formatUnits(q.fundsAmount, 6)}, fee ${formatUnits(q.feeAmount, 6)}, expires in ${minutes.toFixed(1)} min`,
      pass:
        q.shares === '2' && q.fundsAmount === usdt(8n).toString() && minutes > 14 && minutes <= QUOTE_TTL_SECONDS / 60,
    };
  });

  const aliceUsdt = new Contract(settlement.usdt, MOCK_USDT_ABI, alice.signer);
  const aliceEscrow = new Contract(settlement.escrow, ESCROW_ABI, alice.signer);

  await step(
    'S09',
    'Gasless deposit for Alice',
    'Relayer submits, escrow records Alice as payer, Alice pays no gas for it',
    async (txs) => {
      await sent(await mockUsdt.mint(alice.address, usdt(100_100n)), txs);
      await sent(await aliceUsdt.approve(settlement.escrow, MaxUint256), txs);

      const before = await ctx.provider.getBalance(alice.address);
      const { chainId } = await ctx.provider.getNetwork();
      const request = {
        from: alice.address,
        to: settlement.escrow,
        value: 0n,
        gas: 500_000n,
        nonce: await forwarder.getNonce(alice.address),
        data: encodeEscrowDeposit(happy, usdt(10n)),
      };
      const signature = await alice.wallet.signTypedData(
        forwarderDomain(chainId, settlement.forwarder),
        FORWARD_REQUEST_TYPES,
        request,
      );
      const relayed = await relayEscrowDeposit({
        input: { request, signature },
        escrowAddress: settlement.escrow,
        forwarderAddress: settlement.forwarder,
        chainId,
        relayer: ctx.relayer,
      });
      txs.push(relayed.txHash);

      const payer = await escrow.intentPayer(happy);
      const spent = before - (await ctx.provider.getBalance(alice.address));
      return {
        actual: `payer ${payer === alice.address ? 'Alice' : payer}, Alice gas spent on deposit ${formatEther(spent)} POL`,
        pass: payer === alice.address && spent === 0n,
      };
    },
  );

  // Exception cases are deposited together so one confirmation wait covers them.
  const cases: Record<string, string> = {};
  await step(
    'S10',
    'Deposits for the exception cases',
    'Remainder, mismatch, expired, non-KYC, unknown intent and a 100,000 USDT mint all land in escrow',
    async (txs) => {
      const remainder = await quote(alice.address, 7n);
      const mismatch = await quote(alice.address, 10n);
      const expired = await quote(alice.address, 10n, new Date(Date.now() - 20 * 60_000));
      const nonKyc = await quote(david.address, 10n);
      const large = await quote(alice.address, 100_000n);
      const unknown = id(`eqowa-sim:${ctx.runId}:unknown`);
      Object.assign(cases, {
        remainder: remainder.intentId,
        mismatch: mismatch.intentId,
        expired: expired.intentId,
        nonKyc: nonKyc.intentId,
        large: large.intentId,
        unknown,
      });

      await sent(await aliceEscrow.deposit(remainder.intentId, usdt(7n)), txs);
      await sent(await aliceEscrow.deposit(mismatch.intentId, usdt(5n)), txs);
      await sent(await aliceEscrow.deposit(expired.intentId, usdt(10n)), txs);
      await sent(await aliceEscrow.deposit(unknown, usdt(10n)), txs);
      await sent(await aliceEscrow.deposit(large.intentId, usdt(100_000n)), txs);

      await sent(await mockUsdt.mint(david.address, usdt(10n)), txs);
      const davidUsdt = new Contract(settlement.usdt, MOCK_USDT_ABI, david.signer);
      const davidEscrow = new Contract(settlement.escrow, ESCROW_ABI, david.signer);
      await sent(await davidUsdt.approve(settlement.escrow, usdt(10n)), txs);
      await sent(await davidEscrow.deposit(nonKyc.intentId, usdt(10n)), txs);
      return { actual: `${txs.length} transactions confirmed`, pass: true };
    },
  );

  // ----------------------------------------------------------------- settling
  const settledFirstPass = await settleUntil(async () => {
    const statuses = await Promise.all([
      statusOf(happy),
      statusOf(cases.remainder!),
      statusOf(cases.mismatch!),
      statusOf(cases.expired!),
      statusOf(cases.nonKyc!),
      statusOf(cases.large!),
    ]);
    const unknownSeen = (await exceptionKinds(cases.unknown!)).includes('unknown_intent');
    return statuses.join() === 'minted,minted,rejected,rejected,rejected,awaiting_safe_approval' && unknownSeen;
  });
  log(`first settlement pass ${settledFirstPass ? 'complete' : 'timed out'}`);

  const mintEvidence = async (intentId: string) => {
    const q = await mintStore.getQuote(intentId);
    return q?.mintTxHash ? [q.mintTxHash] : [];
  };

  await step(
    'S11',
    'Worker mints Alice 2 shares after 12 blocks',
    'Status minted, mint transaction on chain',
    async (txs) => {
      txs.push(...(await mintEvidence(happy)));
      const status = await statusOf(happy);
      return { actual: `status ${status}`, pass: status === 'minted' && txs.length === 1 };
    },
  );

  await step(
    'S12',
    '7 USDT mints 1 share, 2 USDT remainder queued',
    'Status minted, remainder exception of 2 USDT',
    async (txs) => {
      txs.push(...(await mintEvidence(cases.remainder!)));
      const status = await statusOf(cases.remainder!);
      const row = (await mintStore.listExceptions({ intentId: cases.remainder! })).find(
        (item) => item.kind === 'remainder',
      );
      return {
        actual: `status ${status}, remainder ${row ? formatUnits(String(row.details.remainderAmount), 6) : 'none'} USDT`,
        pass: status === 'minted' && row?.details.remainderAmount === usdt(2n).toString(),
      };
    },
  );

  const rejected = (stepId: string, title: string, key: string, kind: string) =>
    step(stepId, title, `Rejected as ${kind}, exception queued, nothing minted`, async () => {
      const q = await mintStore.getQuote(cases[key]!);
      const kinds = await exceptionKinds(cases[key]!);
      return {
        actual: `status ${q?.status} (${q?.rejectReason}), exceptions ${kinds.join(', ') || 'none'}`,
        pass: q?.status === 'rejected' && q.rejectReason === kind && kinds.includes(kind) && !q.mintTxHash,
      };
    });

  await rejected('S13', 'Quote for 10 USDT paid with 5 USDT', 'mismatch', 'amount_mismatch');
  await rejected('S14', 'Deposit after the 15-minute quote expired', 'expired', 'quote_expired');
  await rejected('S15', 'Deposit from a wallet without approved KYC (David)', 'nonKyc', 'kyc_not_approved');

  await step('S16', 'Deposit against an unknown intent', 'unknown_intent exception, nothing minted', async () => {
    const kinds = await exceptionKinds(cases.unknown!);
    return { actual: `exceptions ${kinds.join(', ') || 'none'}`, pass: kinds.includes('unknown_intent') };
  });

  await step(
    'S17',
    '100,000 USDT held for Safe sign-off',
    'Status awaiting_safe_approval, safe_approval_required queued, nothing minted',
    async () => {
      const q = await mintStore.getQuote(cases.large!);
      const kinds = await exceptionKinds(cases.large!);
      return {
        actual: `status ${q?.status}, exceptions ${kinds.join(', ')}`,
        pass: q?.status === 'awaiting_safe_approval' && kinds.includes('safe_approval_required') && !q.mintTxHash,
      };
    },
  );

  await step(
    'S18',
    'Admin approves with the Safe transaction, worker mints 20,000 shares',
    'Status minted after approval',
    async (txs) => {
      const approved = await approveSafeMint({
        intentId: cases.large!,
        store: mintStore,
        safeTxHash: SIMULATED_SAFE_TX,
        actor: 'simulation',
        now: new Date(),
      });
      if ('error' in approved) {
        throw new Error(approved.error);
      }
      await settleUntil(async () => (await statusOf(cases.large!)) === 'minted');
      txs.push(...(await mintEvidence(cases.large!)));
      const q = await mintStore.getQuote(cases.large!);
      return { actual: `status ${q?.status}, ${shares(q?.shareAmount ?? 0n)} shares`, pass: q?.status === 'minted' };
    },
  );

  await step('S19', 'Alice balance', '2 + 1 + 20,000 = 20,003 shares', async () => {
    const balance = await token.balanceOf(alice.address);
    return { actual: `${shares(balance)} EQOWAG`, pass: balance === 20_003n * ONE_SHARE };
  });

  // ---------------------------------------------------- on-chain enforcement
  await step('S20', 'Mint to a wallet with no identity (Charlie)', 'Token reverts', async () => {
    try {
      await token.mint.staticCall(charlie.address, ONE_SHARE);
      return { actual: 'mint would succeed', pass: false };
    } catch (error) {
      return { actual: `reverted: ${reason(error)}`, pass: true };
    }
  });

  await step(
    'S21',
    'Transfer from Alice to David (United States)',
    'Country module refuses David, allows Alice; transfer reverts',
    async () => {
      const toDavid = await countryModule.moduleCheck(alice.address, david.address, ONE_SHARE, deployment.compliance);
      const toAlice = await countryModule.moduleCheck(alice.address, alice.address, ONE_SHARE, deployment.compliance);
      const canTransfer = await compliance.canTransfer(alice.address, david.address, ONE_SHARE);
      let transfer = 'would succeed';
      try {
        await new Contract(deployment.token, TOKEN_ABI, alice.signer).transfer.staticCall(david.address, ONE_SHARE);
      } catch (error) {
        transfer = `reverted: ${reason(error)}`;
      }
      return {
        actual: `country check David ${toDavid}, Alice ${toAlice}; canTransfer ${canTransfer}; transfer ${transfer}`,
        pass: toDavid === false && toAlice === true && canTransfer === false && transfer.startsWith('reverted'),
      };
    },
  );

  await step(
    'S22',
    'Freshly minted shares are locked',
    "Lock-up module refuses a transfer of Alice's shares for 730 days",
    async () => {
      const allowed = await lockupModule.moduleCheck(alice.address, alice.address, ONE_SHARE, deployment.compliance);
      return { actual: `lock-up check ${allowed}`, pass: allowed === false };
    },
  );

  await step(
    'S23',
    'Audit trail',
    'Mints, the Safe hold and the approval are in the append-only audit log',
    async () => {
      const actions = mintStore.audit.map((row) => row.action);
      const count = (action: string) => actions.filter((item) => item === action).length;
      const summary = ['mint.sent', 'mint.confirmed', 'mint.held_for_safe', 'mint.safe_approved', 'exception.opened']
        .map((action) => `${action} ${count(action)}`)
        .join(', ');
      return {
        actual: summary,
        pass: count('mint.confirmed') === 3 && count('mint.held_for_safe') === 1 && count('mint.safe_approved') === 1,
      };
    },
  );

  const passed = steps.filter((item) => item.pass).length;
  return {
    network: ctx.network,
    chainId: deployment.chainId,
    runId: ctx.runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    contracts: {
      token: deployment.token,
      identityRegistry: deployment.identityRegistry,
      compliance: deployment.compliance,
      claimIssuer: deployment.claimIssuer,
      escrow: settlement.escrow,
      forwarder: settlement.forwarder,
      mockUsdt: settlement.usdt,
      safe: deployment.safe,
    },
    wallets: {
      operator: ctx.operatorWallet.address,
      agent: ctx.agentWallet.address,
      alice: alice.address,
      david: david.address,
      charlie: charlie.address,
    },
    steps,
    passed,
    failed: steps.length - passed,
  };
}
