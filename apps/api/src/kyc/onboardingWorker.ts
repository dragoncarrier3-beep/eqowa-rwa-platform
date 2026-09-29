import { OnboardingRefused, type OnboardingResult } from '../../../../config/onboarding.ts';

import type { IdentityRecord, IdentityStore, OnchainRegistration } from './identityStore.ts';

type Log = Pick<Console, 'info' | 'warn' | 'error'>;

/** onboardInvestor with the contracts and signers already bound. */
export type Onboard = (input: {
  wallet: string;
  countryCode: number;
  knownIdentity?: string;
  onIdentityDeployed: (identityAddress: string) => Promise<void>;
}) => Promise<OnboardingResult>;

export type OnboardingTickResult = { registered: number; failed: number; retrying: number };

/** Transient failures (RPC, gas, nonce) are retried this many times in total. */
export const MAX_ONBOARDING_ATTEMPTS = 5;

/**
 * Registers KYC-approved investors on-chain, one at a time so the agent key
 * never has two transactions racing for a nonce. A refusal (untrusted claim
 * signer, bad country, registry not verifying) will not fix itself, so it
 * fails at once for ops to look at; anything else is retried next tick.
 */
export function createOnboardingWorker(deps: {
  identities: IdentityStore;
  onboard: Onboard;
  pollMs?: number;
  maxAttempts?: number;
  log?: Log;
}) {
  const log = deps.log ?? console;
  const pollMs = deps.pollMs ?? 15_000;
  const maxAttempts = deps.maxAttempts ?? MAX_ONBOARDING_ATTEMPTS;
  let running: Promise<OnboardingTickResult> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;

  async function onboardOne(record: IdentityRecord, result: OnboardingTickResult) {
    const previous: OnchainRegistration = record.onchain ?? {
      status: 'pending',
      identityAddress: null,
      error: null,
      attempts: 0,
    };
    const attempts = previous.attempts + 1;
    let identityAddress = previous.identityAddress;

    if (record.countryCode === null) {
      await deps.identities.updateOnchain(record.walletAddress, {
        ...previous,
        status: 'failed',
        error: 'approved without a country',
        attempts,
      });
      result.failed += 1;
      return;
    }

    try {
      const onboarded = await deps.onboard({
        wallet: record.walletAddress,
        countryCode: record.countryCode,
        knownIdentity: identityAddress ?? undefined,
        onIdentityDeployed: async (address) => {
          identityAddress = address;
          // Saved before the claims, so a crash cannot orphan this identity.
          await deps.identities.updateOnchain(record.walletAddress, {
            status: 'identity_deployed',
            identityAddress: address,
            error: null,
            attempts,
          });
        },
      });
      await deps.identities.updateOnchain(record.walletAddress, {
        status: 'registered',
        identityAddress: onboarded.identityAddress,
        error: null,
        attempts,
      });
      result.registered += 1;
      log.info({ wallet: record.walletAddress, identity: onboarded.identityAddress }, 'investor registered on-chain');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const giveUp = error instanceof OnboardingRefused || attempts >= maxAttempts;
      await deps.identities.updateOnchain(record.walletAddress, {
        status: giveUp ? 'failed' : identityAddress ? 'identity_deployed' : 'pending',
        identityAddress,
        error: message,
        attempts,
      });
      if (giveUp) {
        result.failed += 1;
        log.error({ wallet: record.walletAddress, error: message }, 'on-chain onboarding failed, needs ops');
      } else {
        result.retrying += 1;
        log.warn({ wallet: record.walletAddress, attempts, error: message }, 'on-chain onboarding will retry');
      }
    }
  }

  async function runTick(): Promise<OnboardingTickResult> {
    const result: OnboardingTickResult = { registered: 0, failed: 0, retrying: 0 };
    for (const record of await deps.identities.listForOnboarding()) {
      await onboardOne(record, result);
    }
    return result;
  }

  /** One pass. Concurrent calls share the pass in flight. */
  function tick(): Promise<OnboardingTickResult> {
    if (!running) {
      running = runTick().finally(() => {
        running = undefined;
      });
    }
    return running;
  }

  function schedule() {
    if (stopped) {
      return;
    }
    timer = setTimeout(async () => {
      try {
        await tick();
      } catch (error) {
        log.error({ error: String(error) }, 'onboarding tick failed');
      }
      schedule();
    }, pollMs);
  }

  return {
    tick,
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      log.info({ pollMs }, 'onboarding worker started');
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      await running?.catch(() => undefined);
    },
  };
}
