import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService, type PutObjectInput, type StoredObject } from './storage.service';

@Injectable()
export class R2StorageAdapter extends StorageService {
  private readonly bucket: string;
  private readonly client: S3Client;
  constructor(config: ConfigService) {
    super();
    this.bucket = config.getOrThrow<string>('R2_BUCKET');
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.getOrThrow<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
  }
  async putObject(input: PutObjectInput): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.mimeType,
      }),
    );
    return {
      storageProvider: 'R2',
      bucket: this.bucket,
      objectKey: input.objectKey,
      sizeBytes: input.body.length,
      sha256: this.checksum(input.body),
    };
  }
  async getObject(objectKey: string): Promise<Buffer> {
    const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (!output.Body) throw new Error('Object body missing.');
    return Buffer.from(await output.Body.transformToByteArray());
  }
  async headObject(objectKey: string): Promise<{ sizeBytes: number; mimeType?: string }> {
    const output = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    return { sizeBytes: output.ContentLength ?? 0, mimeType: output.ContentType };
  }
  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
  async getSignedDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), {
      expiresIn: expiresInSeconds,
    });
  }
}
