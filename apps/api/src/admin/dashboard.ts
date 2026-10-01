import { getAddress, isAddress } from 'ethers';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AdminDashboardResponse, AdminInvestorDto, AdminQuoteDto } from '../../../../config/api.ts';
import type { MintQuoteStatus } from '../../../../config/mintStatus.ts';
import type { ControlResult } from '../../../../config/tokenControls.ts';

import type { ChainReader } from '../assets/catalog.ts';
import type { AuditWriter, createAdminGuard } from '../auth/adminAuth.ts';
import type { TokenLedgerStore } from '../indexer/ledger.ts';
import { TOKEN_TRANSFERS_CURSOR } from '../indexer/tokenWorker.ts';
import { toInvestorQuote } from '../investor/quotes.ts';
import type { IdentityStore } from '../kyc/identityStore.ts';
import type { MintStore } from '../mint/mintStore.ts';
import type { SyncStateStore } from '../settlement/syncState.ts';

/** Every pipeline status; the Record keeps this list complete when a status is added. */
const STATUS_SET: Record<MintQuoteStatus, true> = {
  quoted: true,
  deposited: true,
  awaiting_confirmations: true,
  awaiting_safe_approval: true,
  safe_approved: true,
  minting: true,
  minted: true,
  expired: true,
  rejected: true,
};
const ALL_STATUSES = Object.keys(STATUS_SET) as MintQuoteStatus[];

/** Phase 1 holds at most 500 holders, so whole-table reads stay small. */
const READ_LIMIT = 1_000;
const MAX_REASON = 200;

export type AdminDashboardDeps = {
  guard: ReturnType<typeof createAdminGuard>;
  mintStore: MintStore;
  identities: IdentityStore;
  ledger?: TokenLedgerStore;
  syncStore?: SyncStateStore;
  tokenAddress: string;
  chain?: ChainReader;
  /** Freeze or unfreeze through the agent signer; unset makes the routes 503. */
  setWalletFrozen?: (wallet: string, frozen: boolean) => Promise<ControlResult>;
  audit: AuditWriter;
};

export function registerAdminDashboardRoutes(app: FastifyInstance, deps: AdminDashboardDeps) {
  async function head(request: FastifyRequest) {
    try {
      return deps.chain ? await deps.chain.getBlockNumber() : null;
    } catch (error) {
      request.log.warn({ err: error }, 'chain head unavailable');
      return null;
    }
  }

  app.get('/admin/dashboard', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'dashboard:view'))) {
      return reply;
    }
    const [quotes, exceptions, identities, stats, indexedBlock] = await Promise.all([
      deps.mintStore.listQuotes({ statuses: ALL_STATUSES, limit: READ_LIMIT }),
      deps.mintStore.listExceptions({ status: 'open' }),
      deps.identities.list(),
      deps.ledger && deps.tokenAddress ? deps.ledger.stats(deps.tokenAddress) : undefined,
      deps.syncStore?.getCursor(TOKEN_TRANSFERS_CURSOR),
    ]);

    const byStatus = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0])) as Record<MintQuoteStatus, number>;
    for (const quote of quotes) {
      byStatus[quote.status] += 1;
    }
    const count = (predicate: (item: (typeof identities)[number]) => boolean) => identities.filter(predicate).length;

    const response: AdminDashboardResponse = {
      ok: true,
      quotes: { total: quotes.length, byStatus },
      awaitingSafeApproval: byStatus.awaiting_safe_approval,
      openExceptions: exceptions.length,
      kyc: {
        total: identities.length,
        approved: count((item) => item.kycStatus === 'approved'),
        pending: count((item) => item.kycStatus === 'pending'),
        rejected: count((item) => item.kycStatus === 'rejected'),
        blockedCountry: count((item) => item.kycStatus === 'blocked_country'),
        registered: count((item) => item.onchain?.status === 'registered'),
        registrationFailed: count((item) => item.onchain?.status === 'failed'),
      },
      holders: stats
        ? {
            holderWallets: stats.holderWallets,
            frozenWallets: stats.frozenWallets,
            totalSupply: stats.totalSupply.toString(),
            indexedBlock: indexedBlock ?? null,
          }
        : null,
    };
    return response;
  });

  app.get('/admin/quotes', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'quotes:view'))) {
      return reply;
    }
    const query = request.query as { status?: string };
    const statuses = query.status
      ? query.status.split(',').filter((value): value is MintQuoteStatus => value in STATUS_SET)
      : ALL_STATUSES;
    if (statuses.length === 0) {
      return reply.code(400).send({ ok: false, reason: 'invalid_status' });
    }
    const [quotes, currentBlock] = await Promise.all([
      deps.mintStore.listQuotes({ statuses, limit: READ_LIMIT }),
      head(request),
    ]);
    const deposits = await Promise.all(quotes.map((quote) => deps.mintStore.getDeposit(quote.intentId)));
    const rows: AdminQuoteDto[] = quotes.map((quote, index) => ({
      ...toInvestorQuote(quote, deposits[index], currentBlock),
      wallet: quote.wallet,
    }));
    // Stores return oldest first; the queue reads newest first.
    return { ok: true, currentBlock, quotes: rows.reverse() };
  });

  app.get('/admin/investors', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'investors:view'))) {
      return reply;
    }
    const [identities, holders] = await Promise.all([
      deps.identities.list(),
      deps.ledger && deps.tokenAddress ? deps.ledger.listHolders(deps.tokenAddress, { limit: READ_LIMIT }) : [],
    ]);

    // One row per wallet: KYC from the identity store, holding from the indexed ledger.
    const rows = new Map<string, AdminInvestorDto>();
    for (const identity of identities) {
      rows.set(identity.walletAddress.toLowerCase(), {
        walletAddress: getAddress(identity.walletAddress),
        kycStatus: identity.kycStatus,
        countryCode: identity.countryCode,
        registration: identity.onchain?.status ?? 'pending',
        identityAddress: identity.onchain?.identityAddress ?? null,
        registrationError: identity.onchain?.error ?? null,
        balance: '0',
        frozen: false,
        updatedBlock: null,
      });
    }
    for (const holder of holders) {
      const key = holder.walletAddress.toLowerCase();
      const row = rows.get(key) ?? {
        walletAddress: getAddress(holder.walletAddress),
        kycStatus: null,
        countryCode: null,
        registration: null,
        identityAddress: null,
        registrationError: null,
        balance: '0',
        frozen: false,
        updatedBlock: null,
      };
      rows.set(key, {
        ...row,
        balance: holder.balance.toString(),
        frozen: holder.frozen,
        updatedBlock: holder.updatedBlock,
      });
    }
    const investors = [...rows.values()].sort((a, b) => {
      const diff = BigInt(b.balance) - BigInt(a.balance);
      return diff === 0n ? a.walletAddress.localeCompare(b.walletAddress) : diff > 0n ? 1 : -1;
    });
    return { ok: true, investors };
  });

  for (const [action, frozen] of [
    ['freeze', true],
    ['unfreeze', false],
  ] as const) {
    app.post(`/admin/investors/:wallet/${action}`, async (request, reply) => {
      const admin = await deps.guard.authorize(request, reply, 'investors:freeze');
      if (!admin) {
        return reply;
      }
      const { wallet } = request.params as { wallet: string };
      if (!isAddress(wallet)) {
        return reply.code(400).send({ ok: false, reason: 'invalid_address' });
      }
      const body = (request.body ?? {}) as { reason?: unknown };
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      // A freeze blocks someone's shares, so the audit log must say why.
      if (!reason || reason.length > MAX_REASON) {
        return reply.code(400).send({ ok: false, reason: 'reason_required' });
      }
      if (!deps.setWalletFrozen) {
        return reply.code(503).send({ ok: false, reason: 'token_controls_unavailable' });
      }

      let result: ControlResult;
      try {
        result = await deps.setWalletFrozen(getAddress(wallet), frozen);
      } catch (error) {
        request.log.error({ err: error, wallet, action }, 'freeze transaction failed');
        return reply.code(502).send({ ok: false, reason: 'chain_error' });
      }
      await deps.audit({
        actor: admin.actor,
        action: frozen ? 'investor.frozen' : 'investor.unfrozen',
        payload: {
          wallet: getAddress(wallet),
          reason,
          changed: result.changed,
          txHash: result.changed ? result.txHash : null,
        },
      });
      return { ok: true, changed: result.changed, txHash: result.changed ? result.txHash : null };
    });
  }
}
