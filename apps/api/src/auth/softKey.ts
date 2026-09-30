import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * A software security key for tests: builds the same registration and
 * assertion responses a YubiKey sends (attestation "none", ES256), so the real
 * @simplewebauthn/server verification runs end to end without a device.
 */

function cborHead(major: number, length: number): number[] {
  if (length < 24) {
    return [(major << 5) | length];
  }
  if (length < 0x100) {
    return [(major << 5) | 24, length];
  }
  if (length < 0x10000) {
    return [(major << 5) | 25, length >> 8, length & 0xff];
  }
  return [(major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff];
}

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

/** Minimal CBOR: the integers, byte strings, text and maps WebAuthn uses. */
export function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') {
    return Uint8Array.from(value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value));
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat(Uint8Array.from(cborHead(3, bytes.length)), bytes);
  }
  if (value instanceof Uint8Array) {
    return concat(Uint8Array.from(cborHead(2, value.length)), value);
  }
  const parts: Uint8Array[] = [Uint8Array.from(cborHead(5, value.size))];
  for (const [key, item] of value) {
    parts.push(cbor(key), cbor(item));
  }
  return concat(...parts);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const sha256 = (bytes: Uint8Array | string) => new Uint8Array(createHash('sha256').update(bytes).digest());

function counterBytes(counter: number): Uint8Array {
  return Uint8Array.from([(counter >>> 24) & 0xff, (counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
}

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

export class SoftKey {
  readonly credentialId = new Uint8Array(randomBytes(16));
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter = 0;

  constructor() {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.publicJwk = { x: jwk.x, y: jwk.y };
  }

  get id() {
    return b64url(this.credentialId);
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string) {
    return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** Answer to navigator.credentials.create() for the given options. */
  register(options: { challenge: string; rp: { id?: string } }, origin: string, rpId = options.rp.id ?? '') {
    const cose = new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, new Uint8Array(Buffer.from(this.publicJwk.x, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(this.publicJwk.y, 'base64url'))],
    ]);
    const authData = concat(
      sha256(rpId),
      Uint8Array.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA]),
      counterBytes(this.counter),
      new Uint8Array(16), // AAGUID
      Uint8Array.from([this.credentialId.length >> 8, this.credentialId.length & 0xff]),
      this.credentialId,
      cbor(cose),
    );
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge, origin)),
        attestationObject: b64url(attestationObject),
        transports: ['usb' as const],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'cross-platform' as const,
    };
  }

  /** Answer to navigator.credentials.get(). Each use raises the signature counter, like hardware. */
  sign(options: { challenge: string; rpId?: string }, origin: string, rpId = options.rpId ?? '', counter?: number) {
    this.counter = counter ?? this.counter + 1;
    const authData = concat(
      sha256(rpId),
      Uint8Array.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED]),
      counterBytes(this.counter),
    );
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin);
    const signature = sign('sha256', concat(authData, sha256(clientDataJSON)), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(new Uint8Array(signature)),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'cross-platform' as const,
    };
  }
}
