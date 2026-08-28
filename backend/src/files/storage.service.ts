import { createHash } from 'node:crypto';

export interface PutObjectInput {
  objectKey: string;
  body: Buffer;
  mimeType: string;
}
export interface StoredObject {
  storageProvider: 'LOCAL' | 'R2';
  bucket: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
}
export abstract class StorageService {
  abstract putObject(input: PutObjectInput): Promise<StoredObject>;
  abstract getObject(objectKey: string): Promise<Buffer>;
  abstract headObject(objectKey: string): Promise<{ sizeBytes: number; mimeType?: string }>;
  abstract deleteObject(objectKey: string): Promise<void>;
  abstract getSignedDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string | null>;
  protected checksum(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }
}
