import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { FileStorage } from './store.ts';

/**
 * Documents in a private S3 bucket. The API streams bytes itself rather than
 * handing out bucket links, so the KYC check on every download cannot be
 * bypassed. Credentials come from the server's IAM role, never from env.
 */
export class S3Storage implements FileStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
    client?: S3Client,
  ) {
    this.client = client ?? new S3Client({ region });
  }

  async put(key: string, bytes: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: 'application/pdf',
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(key: string) {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return response.Body ? Buffer.from(await response.Body.transformToByteArray()) : null;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
