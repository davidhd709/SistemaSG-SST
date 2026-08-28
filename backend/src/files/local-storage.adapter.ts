import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { StorageService, type PutObjectInput, type StoredObject } from './storage.service';

@Injectable()
export class LocalStorageAdapter extends StorageService {
  private readonly root = resolve(process.cwd(), 'storage');
  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const target = this.path(input.objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body, { flag: 'wx' });
    return {
      storageProvider: 'LOCAL',
      bucket: 'local',
      objectKey: input.objectKey,
      sizeBytes: input.body.length,
      sha256: this.checksum(input.body),
    };
  }
  async getObject(objectKey: string): Promise<Buffer> {
    return readFile(this.path(objectKey));
  }
  async headObject(objectKey: string): Promise<{ sizeBytes: number }> {
    const metadata = await stat(this.path(objectKey));
    return { sizeBytes: metadata.size };
  }
  async deleteObject(objectKey: string): Promise<void> {
    await rm(this.path(objectKey), { force: true });
  }
  async getSignedDownloadUrl(): Promise<string | null> {
    return null;
  }
  private path(objectKey: string): string {
    const target = resolve(this.root, objectKey);
    // `sep` mantiene la comprobación válida en Linux y en Windows.
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('Invalid local storage object key.');
    return target;
  }
}
