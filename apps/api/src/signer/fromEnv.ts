import { Wallet, type Provider, type Signer } from 'ethers';

import { resolveRelayerPrivateKey, resolveSigningBackend, type SignerEnv } from '../../../../config/signer.ts';

import { KmsSigner, type KmsEcdsaClient } from './kmsSigner.ts';

export function createAgentSigner(params: {
  env: SignerEnv;
  provider?: Provider;
  kmsClient?: KmsEcdsaClient;
}): Signer | null {
  const backend = resolveSigningBackend(params.env);
  if (backend.kind === 'kms') {
    if (!params.kmsClient) {
      throw new Error('KMS_KEY_ARN is set but no KMS client was provided');
    }
    return new KmsSigner(params.kmsClient, params.provider);
  }
  if (backend.kind === 'env') {
    return new Wallet(backend.privateKey, params.provider);
  }
  return null;
}

export function createRelayerSigner(params: { env: SignerEnv; provider?: Provider }): Wallet | null {
  const key = resolveRelayerPrivateKey(params.env);
  if (!key) {
    return null;
  }
  return new Wallet(key, params.provider);
}
