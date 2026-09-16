/**
 * Signing backend for the agent (mint) and optional KMS hand-off.
 *
 * KMS_KEY_ARN wins when set, so a leftover env private key cannot bypass KMS.
 * The AWS client is injected; this file only chooses which backend to use.
 */

export type SignerEnv = {
  KMS_KEY_ARN?: string;
  AGENT_SIGNER_PRIVATE_KEY?: string;
  RELAYER_PRIVATE_KEY?: string;
};

export type SigningBackend = { kind: 'kms'; keyArn: string } | { kind: 'env'; privateKey: string } | { kind: 'none' };

export function resolveSigningBackend(env: SignerEnv): SigningBackend {
  const arn = env.KMS_KEY_ARN?.trim();
  if (arn) {
    return { kind: 'kms', keyArn: arn };
  }

  const privateKey = env.AGENT_SIGNER_PRIVATE_KEY?.trim();
  if (privateKey) {
    return { kind: 'env', privateKey };
  }

  return { kind: 'none' };
}

export function resolveRelayerPrivateKey(env: SignerEnv): string | null {
  const relayer = env.RELAYER_PRIVATE_KEY?.trim();
  if (relayer) {
    return relayer;
  }

  const backend = resolveSigningBackend(env);
  return backend.kind === 'env' ? backend.privateKey : null;
}
