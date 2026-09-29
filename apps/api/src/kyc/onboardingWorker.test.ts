import assert from 'node:assert/strict';
import test from 'node:test';

import { OnboardingRefused } from '../../../../config/onboarding.ts';

import { createOnboardingWorkerFromEnv, type Stores } from '../bootstrap.ts';

import { MemoryIdentityStore, type IdentityRecord } from './identityStore.ts';
import { createOnboardingWorker, type Onboard } from './onboardingWorker.ts';

const WALLET = '0x1111111111111111111111111111111111111111';
const IDENTITY = '0x9999999999999999999999999999999999999999';
const quiet = { info() {}, warn() {}, error() {} };

function record(overrides: Partial<IdentityRecord> = {}): IdentityRecord {
  return {
    walletAddress: WALLET,
    onchainIdAddress: '0x3333333333333333333333333333333333333333',
    countryCode: 288,
    kycStatus: 'approved',
    applicantId: 'app-1',
    claims: [1, 2],
    ...overrides,
  };
}

async function storeWith(...records: IdentityRecord[]) {
  const identities = new MemoryIdentityStore();
  for (const item of records) {
    await identities.recordKyc(item);
  }
  return identities;
}

test('registers an approved investor and records the identity', async () => {
  const identities = await storeWith(record());
  const calls: Parameters<Onboard>[0][] = [];
  const worker = createOnboardingWorker({
    identities,
    log: quiet,
    onboard: async (input) => {
      calls.push(input);
      await input.onIdentityDeployed(IDENTITY);
      return { identityAddress: IDENTITY, txHashes: ['0x1', '0x2', '0x3', '0x4'], alreadyVerified: false };
    },
  });

  assert.deepEqual(await worker.tick(), { registered: 1, failed: 0, retrying: 0 });
  assert.equal(calls[0].wallet, WALLET);
  assert.equal(calls[0].countryCode, 288);
  assert.equal(calls[0].knownIdentity, undefined);
  assert.deepEqual((await identities.getByWallet(WALLET))?.onchain, {
    status: 'registered',
    identityAddress: IDENTITY,
    error: null,
    attempts: 1,
  });
  // Registered investors are not picked up again.
  assert.deepEqual(await worker.tick(), { registered: 0, failed: 0, retrying: 0 });
});

test('a crash after the identity deploy resumes with the same identity', async () => {
  const identities = await storeWith(record());
  let run = 0;
  const seen: (string | undefined)[] = [];
  const worker = createOnboardingWorker({
    identities,
    log: quiet,
    onboard: async (input) => {
      run += 1;
      seen.push(input.knownIdentity);
      if (run === 1) {
        await input.onIdentityDeployed(IDENTITY);
        throw new Error('nonce too low');
      }
      return { identityAddress: IDENTITY, txHashes: ['0x2'], alreadyVerified: false };
    },
  });

  assert.deepEqual(await worker.tick(), { registered: 0, failed: 0, retrying: 1 });
  assert.equal((await identities.getByWallet(WALLET))?.onchain?.status, 'identity_deployed');
  assert.deepEqual(await worker.tick(), { registered: 1, failed: 0, retrying: 0 });
  assert.deepEqual(seen, [undefined, IDENTITY]);
});

test('a refusal fails at once, a transient error fails after five attempts', async () => {
  const refused = await storeWith(record());
  const refusing = createOnboardingWorker({
    identities: refused,
    log: quiet,
    onboard: async () => {
      throw new OnboardingRefused('claim_signer_not_trusted', 'not a claim key');
    },
  });
  assert.deepEqual(await refusing.tick(), { registered: 0, failed: 1, retrying: 0 });
  assert.equal((await refused.getByWallet(WALLET))?.onchain?.error, 'not a claim key');
  // Failed identities wait for ops, they are not retried.
  assert.deepEqual(await refusing.tick(), { registered: 0, failed: 0, retrying: 0 });

  const flaky = await storeWith(record());
  let attempts = 0;
  const failing = createOnboardingWorker({
    identities: flaky,
    log: quiet,
    onboard: async () => {
      attempts += 1;
      throw new Error('rpc timeout');
    },
  });
  for (let tick = 0; tick < 4; tick += 1) {
    assert.equal((await failing.tick()).retrying, 1);
  }
  assert.equal((await failing.tick()).failed, 1);
  assert.equal(attempts, 5);
  assert.equal((await flaky.getByWallet(WALLET))?.onchain?.status, 'failed');
});

test('only approved investors with a country are onboarded', async () => {
  const identities = await storeWith(
    record({ walletAddress: '0x2222222222222222222222222222222222222222', applicantId: 'a', kycStatus: 'rejected' }),
    record({
      walletAddress: '0x4444444444444444444444444444444444444444',
      applicantId: 'b',
      kycStatus: 'blocked_country',
    }),
    record({ walletAddress: '0x5555555555555555555555555555555555555555', applicantId: 'c', countryCode: null }),
  );
  const onboarded: string[] = [];
  const worker = createOnboardingWorker({
    identities,
    log: quiet,
    onboard: async (input) => {
      onboarded.push(input.wallet);
      return { identityAddress: IDENTITY, txHashes: [], alreadyVerified: true };
    },
  });
  assert.deepEqual(await worker.tick(), { registered: 0, failed: 1, retrying: 0 });
  assert.deepEqual(onboarded, []);
});

test('a repeat Sumsub review does not reset the on-chain registration', async () => {
  const identities = await storeWith(record());
  await identities.updateOnchain(WALLET, { status: 'registered', identityAddress: IDENTITY, error: null, attempts: 1 });
  await identities.recordKyc(record());
  assert.equal((await identities.getByWallet(WALLET))?.onchain?.status, 'registered');
  assert.deepEqual(await identities.listForOnboarding(), []);
});

test('createOnboardingWorkerFromEnv needs the contracts, a claim key and the agent', () => {
  const stores = { identities: new MemoryIdentityStore() } as unknown as Stores;
  const agent = {} as never;
  const addresses = {
    IDENTITY_REGISTRY_ADDRESS: '0x1111111111111111111111111111111111111111',
    CLAIM_ISSUER_ADDRESS: '0x2222222222222222222222222222222222222222',
    IDENTITY_IMPLEMENTATION_AUTHORITY_ADDRESS: '0x3333333333333333333333333333333333333333',
  };
  const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

  assert.deepEqual(createOnboardingWorkerFromEnv(stores, { ONBOARDING_WORKER: 'off' }, agent), {
    disabled: 'ONBOARDING_WORKER=off',
  });
  assert.deepEqual(createOnboardingWorkerFromEnv(stores, {}, agent), {
    disabled: 'missing IDENTITY_REGISTRY_ADDRESS, CLAIM_ISSUER_ADDRESS, IDENTITY_IMPLEMENTATION_AUTHORITY_ADDRESS',
  });
  assert.deepEqual(createOnboardingWorkerFromEnv(stores, addresses, agent), {
    disabled: 'set CLAIM_ISSUER_SIGNING_KEY to a claim signing key of the ClaimIssuer',
  });
  assert.deepEqual(createOnboardingWorkerFromEnv(stores, { ...addresses, CLAIM_ISSUER_SIGNING_KEY: key }), {
    disabled: 'agent signer unavailable',
  });
  assert.ok('worker' in createOnboardingWorkerFromEnv(stores, { ...addresses, CLAIM_ISSUER_SIGNING_KEY: key }, agent));
});
