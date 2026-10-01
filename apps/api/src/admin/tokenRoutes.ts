import { Contract, getAddress, isAddress } from 'ethers';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  BALANCE_CAP_ABI,
  DAILY_MINT_CAP_ABI,
  HOLDER_COUNT_CAP_ABI,
  TIME_LOCKUP_ABI,
  TOKEN_VIEW_ABI,
} from '../../../../config/abis.ts';
import type { AdminComplianceResponse } from '../../../../config/api.ts';
import { safeBatchFile, type ComplianceChange, type ComplianceModules } from '../../../../config/complianceTx.ts';
import { ONE_SHARE, TOKEN_DECIMALS } from '../../../../config/eqowa.ts';
import { decodeRevert } from '../../../../config/errors.ts';
import type { ControlResult } from '../../../../config/tokenControls.ts';

import type { ChainReader } from '../assets/catalog.ts';
import type { AuditWriter, createAdminGuard } from '../auth/adminAuth.ts';

const COUNTRY_ALLOWLIST_VIEW_ABI = [
  'function isCountryAllowed(address _compliance, uint16 _country) view returns (bool)',
];
const MAX_REASON = 200;
/** Above any cap the rules allow; the chain would refuse larger anyway. */
const MAX_SHARES = 10_000_000n;

export type TokenActions = {
  setPaused(paused: boolean): Promise<ControlResult>;
  mint(wallet: string, amount: bigint): Promise<string>;
  burn(wallet: string, amount: bigint): Promise<string>;
};

export type TokenRouteDeps = {
  guard: ReturnType<typeof createAdminGuard>;
  audit: AuditWriter;
  chain?: ChainReader;
  chainId: number;
  tokenAddress: string;
  modules: ComplianceModules;
  safeAddress?: string;
  /** Agent-signed actions; unset makes the control routes 503. */
  tokenActions?: TokenActions;
  now: () => Date;
};

function readReason(body: unknown): string | null {
  const reason = (body as { reason?: unknown } | null)?.reason;
  const text = typeof reason === 'string' ? reason.trim() : '';
  return text && text.length <= MAX_REASON ? text : null;
}

function readShares(value: unknown): bigint | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (!/^\d{1,12}$/.test(text)) {
    return null;
  }
  const shares = BigInt(text);
  return shares > 0n && shares <= MAX_SHARES ? shares : null;
}

/** Token controls for operations, and the compliance panel that prepares Safe transactions. */
export function registerTokenRoutes(app: FastifyInstance, deps: TokenRouteDeps) {
  async function chainAction(
    request: FastifyRequest,
    reply: FastifyReply,
    audit: { actor: string; action: string; payload: Record<string, unknown> },
    run: () => Promise<ControlResult | string>,
  ) {
    let result: ControlResult | string;
    try {
      result = await run();
    } catch (error) {
      // The chain refused: say why in the rules' own words, and audit nothing.
      const revert = decodeRevert(error);
      request.log.error({ err: error, action: audit.action }, 'token action failed');
      return reply.code(502).send({ ok: false, reason: 'chain_error', detail: revert.message });
    }
    const txHash = typeof result === 'string' ? result : result.changed ? result.txHash : null;
    const changed = typeof result === 'string' ? true : result.changed;
    await deps.audit({ ...audit, payload: { ...audit.payload, changed, txHash } });
    return { ok: true, changed, txHash };
  }

  for (const [action, paused] of [
    ['pause', true],
    ['unpause', false],
  ] as const) {
    app.post(`/admin/token/${action}`, async (request, reply) => {
      const admin = await deps.guard.authorize(request, reply, 'token:pause');
      if (!admin) {
        return reply;
      }
      const reason = readReason(request.body);
      if (!reason) {
        return reply.code(400).send({ ok: false, reason: 'reason_required' });
      }
      if (!deps.tokenActions) {
        return reply.code(503).send({ ok: false, reason: 'token_controls_unavailable' });
      }
      const actions = deps.tokenActions;
      return chainAction(
        request,
        reply,
        { actor: admin.actor, action: paused ? 'token.paused' : 'token.unpaused', payload: { reason } },
        () => actions.setPaused(paused),
      );
    });
  }

  for (const action of ['mint', 'burn'] as const) {
    app.post(`/admin/token/${action}`, async (request, reply) => {
      const admin = await deps.guard.authorize(request, reply, action === 'mint' ? 'token:mint' : 'token:burn');
      if (!admin) {
        return reply;
      }
      const body = (request.body ?? {}) as { wallet?: unknown; shares?: unknown };
      const wallet = typeof body.wallet === 'string' && isAddress(body.wallet) ? getAddress(body.wallet) : null;
      const shares = readShares(body.shares);
      const reason = readReason(request.body);
      if (!wallet) {
        return reply.code(400).send({ ok: false, reason: 'invalid_address' });
      }
      if (!shares) {
        return reply.code(400).send({ ok: false, reason: 'invalid_amount' });
      }
      if (!reason) {
        return reply.code(400).send({ ok: false, reason: 'reason_required' });
      }
      if (!deps.tokenActions) {
        return reply.code(503).send({ ok: false, reason: 'token_controls_unavailable' });
      }
      const actions = deps.tokenActions;
      const amount = shares * ONE_SHARE;
      return chainAction(
        request,
        reply,
        {
          actor: admin.actor,
          action: action === 'mint' ? 'token.minted' : 'token.burned',
          payload: { wallet, shares: shares.toString(), reason },
        },
        () => (action === 'mint' ? actions.mint(wallet, amount) : actions.burn(wallet, amount)),
      );
    });
  }

  app.get('/admin/compliance', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'compliance:view'))) {
      return reply;
    }
    if (!deps.chain || !isAddress(deps.tokenAddress)) {
      return reply.code(503).send({ ok: false, reason: 'chain_unavailable' });
    }
    const chain = deps.chain;
    try {
      const blockNumber = await chain.getBlockNumber();
      const at = { blockTag: blockNumber };
      const token = new Contract(deps.tokenAddress, TOKEN_VIEW_ABI, chain);
      const [compliance, paused] = (await Promise.all([token.compliance(at), token.paused(at)])) as [string, boolean];
      const read = async (address: string | undefined, abi: string[], fn: string) =>
        address ? ((await new Contract(address, abi, chain)[fn](compliance, at)) as bigint) : null;
      const [maxBalance, maxHolderCount, holderCount, dailyMintCap, remaining, lockup] = await Promise.all([
        read(deps.modules.balanceCap, BALANCE_CAP_ABI, 'getMaxBalance'),
        read(deps.modules.holderCountCap, HOLDER_COUNT_CAP_ABI, 'getMaxHolderCount'),
        read(deps.modules.holderCountCap, HOLDER_COUNT_CAP_ABI, 'getHolderCount'),
        read(deps.modules.dailyMintCap, DAILY_MINT_CAP_ABI, 'getDailyMintCap'),
        read(deps.modules.dailyMintCap, DAILY_MINT_CAP_ABI, 'getRemainingAllowance'),
        read(deps.modules.timeLockup, TIME_LOCKUP_ABI, 'getLockupDuration'),
      ]);
      const shares = (value: bigint | null) =>
        value === null ? null : (value / 10n ** BigInt(TOKEN_DECIMALS)).toString();
      const response: AdminComplianceResponse = {
        ok: true,
        blockNumber,
        compliance: getAddress(compliance),
        safe: deps.safeAddress ? getAddress(deps.safeAddress) : null,
        paused,
        rules: {
          maxBalanceShares: shares(maxBalance),
          maxHolderCount: maxHolderCount?.toString() ?? null,
          holderCount: holderCount?.toString() ?? null,
          dailyMintCapShares: shares(dailyMintCap),
          remainingMintShares: shares(remaining),
          lockupDays: lockup === null ? null : (lockup / 86_400n).toString(),
        },
        countryModule: deps.modules.countryAllowlist ? getAddress(deps.modules.countryAllowlist) : null,
      };
      return response;
    } catch (error) {
      request.log.error({ err: error }, 'compliance read failed');
      return reply.code(503).send({ ok: false, reason: 'chain_unavailable' });
    }
  });

  app.get('/admin/compliance/countries', async (request, reply) => {
    if (!(await deps.guard.authorize(request, reply, 'compliance:view'))) {
      return reply;
    }
    const { codes } = request.query as { codes?: string };
    const list = (codes ?? '')
      .split(',')
      .map((code) => Number(code.trim()))
      .filter((code) => Number.isInteger(code) && code > 0 && code < 1000)
      .slice(0, 50);
    if (list.length === 0) {
      return reply.code(400).send({ ok: false, reason: 'invalid_countries' });
    }
    if (!deps.chain || !deps.modules.countryAllowlist || !isAddress(deps.tokenAddress)) {
      return reply.code(503).send({ ok: false, reason: 'chain_unavailable' });
    }
    const chain = deps.chain;
    const compliance = (await new Contract(deps.tokenAddress, TOKEN_VIEW_ABI, chain).compliance()) as string;
    const module = new Contract(deps.modules.countryAllowlist, COUNTRY_ALLOWLIST_VIEW_ABI, chain);
    const allowed = await Promise.all(
      list.map((code) => module.isCountryAllowed(compliance, code) as Promise<boolean>),
    );
    return { ok: true, countries: list.map((code, index) => ({ code, allowed: allowed[index] })) };
  });

  app.post('/admin/compliance/prepare', async (request, reply) => {
    const admin = await deps.guard.authorize(request, reply, 'compliance:prepare');
    if (!admin) {
      return reply;
    }
    const body = (request.body ?? {}) as { kind?: unknown; value?: unknown; countries?: unknown };
    let change: ComplianceChange | null = null;
    const value = readShares(body.value);
    const countries = Array.isArray(body.countries)
      ? body.countries.map(Number).filter((code) => Number.isInteger(code) && code > 0 && code < 1000)
      : [];
    switch (body.kind) {
      case 'maxBalance':
      case 'dailyMintCap':
        change = value ? { kind: body.kind, shares: value } : null;
        break;
      case 'maxHolderCount':
        change = value ? { kind: 'maxHolderCount', holders: value } : null;
        break;
      case 'lockupDays':
        change = value && value <= 3_650n ? { kind: 'lockupDays', days: value } : null;
        break;
      case 'allowCountries':
      case 'disallowCountries':
        change = countries.length > 0 && countries.length <= 50 ? { kind: body.kind, countries } : null;
        break;
    }
    if (!change) {
      return reply.code(400).send({ ok: false, reason: 'invalid_change' });
    }

    let compliance: string;
    try {
      if (!deps.chain || !isAddress(deps.tokenAddress)) {
        throw new Error('no chain');
      }
      compliance = (await new Contract(deps.tokenAddress, TOKEN_VIEW_ABI, deps.chain).compliance()) as string;
    } catch {
      return reply.code(503).send({ ok: false, reason: 'chain_unavailable' });
    }

    let file;
    try {
      file = safeBatchFile({
        chainId: deps.chainId,
        compliance,
        safe: deps.safeAddress,
        change,
        modules: deps.modules,
        createdAt: deps.now(),
      });
    } catch {
      return reply.code(503).send({ ok: false, reason: 'module_unconfigured' });
    }
    // Preparing changes nothing on-chain, but who proposed what is worth keeping.
    await deps.audit({
      actor: admin.actor,
      action: 'compliance.prepared',
      payload: { change: file.meta.description, compliance: getAddress(compliance) },
    });
    return { ok: true, description: file.meta.description, file };
  });
}
