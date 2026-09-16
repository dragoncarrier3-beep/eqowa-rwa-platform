import {
  AbstractSigner,
  Signature,
  SigningKey,
  Transaction,
  TypedDataEncoder,
  getBytes,
  hashMessage,
  keccak256,
  type Provider,
  type TransactionRequest,
  type TypedDataDomain,
  type TypedDataField,
} from 'ethers';

/**
 * ECDSA over a 32-byte digest. AWS KMS (or a test wallet) implements this.
 * Production maps SignCommand output into a 65-byte Ethereum signature.
 */
export type KmsEcdsaClient = {
  address: string;
  signDigest(digest: Uint8Array): Promise<string>;
};

/** Wrap a local SigningKey so tests prove the same path production KMS will use. */
export function kmsClientFromSigningKey(signingKey: SigningKey, address: string): KmsEcdsaClient {
  return {
    address,
    async signDigest(digest: Uint8Array) {
      return Signature.from(signingKey.sign(digest)).serialized;
    },
  };
}

export class KmsSigner extends AbstractSigner {
  readonly #client: KmsEcdsaClient;

  constructor(client: KmsEcdsaClient, provider?: null | Provider) {
    super(provider);
    this.#client = client;
  }

  async getAddress(): Promise<string> {
    return this.#client.address;
  }

  connect(provider: null | Provider): KmsSigner {
    return new KmsSigner(this.#client, provider);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const populated = await this.populateTransaction(tx);
    delete populated.from;
    const unsigned = Transaction.from(populated);
    unsigned.signature = await this.#client.signDigest(getBytes(keccak256(unsigned.unsignedSerialized)));
    return unsigned.serialized;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.#client.signDigest(getBytes(hashMessage(message)));
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, unknown>,
  ): Promise<string> {
    return this.#client.signDigest(getBytes(TypedDataEncoder.hash(domain, types, value)));
  }
}
