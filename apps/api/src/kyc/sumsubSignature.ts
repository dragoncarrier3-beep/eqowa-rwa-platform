import { createHmac, timingSafeEqual } from 'node:crypto';

const ALGORITHMS: Record<string, string> = {
  HMAC_SHA1_HEX: 'sha1',
  HMAC_SHA256_HEX: 'sha256',
  HMAC_SHA512_HEX: 'sha512',
};

function hexBuffersEqual(left: string, right: string): boolean {
  try {
    const leftBuf = Buffer.from(left, 'hex');
    const rightBuf = Buffer.from(right, 'hex');
    if (leftBuf.length === 0 || leftBuf.length !== rightBuf.length) {
      return false;
    }
    return timingSafeEqual(leftBuf, rightBuf);
  } catch {
    return false;
  }
}

/**
 * Verify a Sumsub webhook digest.
 * Empty secret is mock mode: unsigned local payloads are accepted.
 */
export function verifySumsubDigest(params: {
  rawBody: string;
  secret: string;
  digest: string | undefined;
  alg: string | undefined;
}): boolean {
  const { rawBody, secret, digest, alg } = params;
  if (!secret) {
    return true;
  }
  if (!digest) {
    return false;
  }

  const algorithm = ALGORITHMS[(alg ?? 'HMAC_SHA1_HEX').toUpperCase()] ?? 'sha1';
  const expected = createHmac(algorithm, secret).update(rawBody).digest('hex');
  return hexBuffersEqual(digest.toLowerCase(), expected);
}

export function sumsubHmacHex(rawBody: string, secret: string, alg: string = 'HMAC_SHA256_HEX'): string {
  const algorithm = ALGORITHMS[alg.toUpperCase()] ?? 'sha256';
  return createHmac(algorithm, secret).update(rawBody).digest('hex');
}
