import assert from 'node:assert/strict';
import test from 'node:test';

import { Wallet, verifyMessage } from 'ethers';

import { resolveRelayerPrivateKey, resolveSigningBackend } from '../../../../config/signer.ts';

import { createAgentSigner, createRelayerSigner } from './fromEnv.ts';
import { kmsClientFromSigningKey } from './kmsSigner.ts';

test('KMS_KEY_ARN wins over a leftover env private key', () => {
  const backend = resolveSigningBackend({
    KMS_KEY_ARN: 'arn:aws:kms:test:key',
    AGENT_SIGNER_PRIVATE_KEY: '0x' + '11'.repeat(32),
  });
  assert.deepEqual(backend, { kind: 'kms', keyArn: 'arn:aws:kms:test:key' });
});

test('env backend is used when KMS is unset', () => {
  const key = '0x' + '22'.repeat(32);
  assert.deepEqual(resolveSigningBackend({ AGENT_SIGNER_PRIVATE_KEY: key }), { kind: 'env', privateKey: key });
  assert.equal(resolveSigningBackend({}).kind, 'none');
});

test('relayer key falls back to the env agent key', () => {
  const key = '0x' + '33'.repeat(32);
  assert.equal(resolveRelayerPrivateKey({ AGENT_SIGNER_PRIVATE_KEY: key }), key);
  assert.equal(resolveRelayerPrivateKey({ RELAYER_PRIVATE_KEY: key }), key);
  assert.equal(resolveRelayerPrivateKey({ KMS_KEY_ARN: 'arn:aws:kms:test:key' }), null);
});

test('KmsSigner recovers to the wrapped key address', async () => {
  const wallet = Wallet.createRandom();
  const signer = createAgentSigner({
    env: { KMS_KEY_ARN: 'arn:aws:kms:test:key' },
    kmsClient: kmsClientFromSigningKey(wallet.signingKey, wallet.address),
  });
  assert.ok(signer);
  const message = 'eqowa-m2-06';
  const signature = await signer.signMessage(message);
  assert.equal(verifyMessage(message, signature), wallet.address);
});

test('createAgentSigner throws when KMS is selected without a client', () => {
  assert.throws(() => createAgentSigner({ env: { KMS_KEY_ARN: 'arn:aws:kms:test:key' } }), /no KMS client/);
});

test('createRelayerSigner uses RELAYER_PRIVATE_KEY', async () => {
  const wallet = Wallet.createRandom();
  const relayer = createRelayerSigner({ env: { RELAYER_PRIVATE_KEY: wallet.privateKey } });
  assert.equal(await relayer?.getAddress(), wallet.address);
});
