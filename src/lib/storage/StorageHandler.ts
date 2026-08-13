import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  type LifecycleRule,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { normalizeS3Endpoint } from './normalizeS3Endpoint';
import { buildContentDisposition } from '../buildContentDisposition';
import { getSafeFilename } from '../getSafeFilename';

export interface StoredObject {
  Body: Buffer | undefined;
}

class StorageHandler {
  s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      endpoint: normalizeS3Endpoint(process.env.SPACES_ENDPOINT),
      region: process.env.SPACES_REGION ?? 'us-east-1',
    });
  }

  uniqify(
    name: string,
    prefix: string,
    maxLength: number,
    suffix: string
  ): string {
    const now = Date.now().toString();
    let uniqueName = `${prefix}-${now}-${name}`.substring(
      0,
      maxLength - (suffix.length + 1)
    );
    if (!uniqueName.endsWith(suffix)) {
      uniqueName += `.${suffix}`;
    }
    return uniqueName;
  }

  static DefaultBucketName(): string {
    return process.env.SPACES_DEFAULT_BUCKET_NAME!;
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: StorageHandler.DefaultBucketName(),
          Key: key,
        })
      );
      return true;
    } catch (err) {
      console.info('Delete file failed');
      console.error(err);
      return false;
    }
  }

  async getContents(maxKeys: number = 1000): Promise<_Object[] | undefined> {
    console.debug('getting max', maxKeys, 'keys');
    const files: _Object[] = [];
    try {
      let continuationToken: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const objects = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: StorageHandler.DefaultBucketName(),
            MaxKeys: maxKeys,
            ContinuationToken: continuationToken,
          })
        );
        if (objects.Contents) {
          files.push(...objects.Contents);
        }
        continuationToken = objects.NextContinuationToken;
        hasMore =
          files.length < maxKeys &&
          Boolean(objects.IsTruncated) &&
          continuationToken != null;
      }
    } catch (err) {
      console.info('Get contents failed');
      console.error(err);
      throw err instanceof Error ? err : new Error(String(err));
    }
    console.debug('recieved', files.length, 'keys');
    return files;
  }

  async getFileContents(key: string): Promise<StoredObject> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: StorageHandler.DefaultBucketName(),
        Key: key,
      })
    );
    if (response.Body == null) {
      return { Body: undefined };
    }
    const bytes = await response.Body.transformToByteArray();
    return { Body: Buffer.from(bytes) };
  }

  async uploadFile(name: string, data: Buffer | string): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: StorageHandler.DefaultBucketName(),
          Key: name,
          Body: data,
        })
      );
    } catch (err) {
      console.info('Upload file failed');
      console.error(err);
      throw err;
    }
  }

  getPresignedUrl(
    key: string,
    expiresSeconds = 3600,
    filename?: string
  ): Promise<string> {
    const command =
      filename != null
        ? new GetObjectCommand({
            Bucket: StorageHandler.DefaultBucketName(),
            Key: key,
            ResponseContentDisposition: buildContentDisposition(
              getSafeFilename(filename)
            ),
            ResponseContentType: 'application/octet-stream',
          })
        : new GetObjectCommand({
            Bucket: StorageHandler.DefaultBucketName(),
            Key: key,
          });
    return getSignedUrl(this.s3, command, { expiresIn: expiresSeconds });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: StorageHandler.DefaultBucketName(),
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async listByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: StorageHandler.DefaultBucketName(),
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of response.Contents ?? []) {
        if (obj.Key != null) keys.push(obj.Key);
      }
      continuationToken = response.NextContinuationToken;
      hasMore = Boolean(response.IsTruncated) && continuationToken != null;
    }
    return keys;
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const objects = keys.map((Key) => ({ Key }));
    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: StorageHandler.DefaultBucketName(),
        Delete: { Objects: objects, Quiet: true },
      })
    );
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = await this.listByPrefix(prefix);
    const batchSize = 1000;
    for (let start = 0; start < keys.length; start += batchSize) {
      await this.deleteObjects(keys.slice(start, start + batchSize));
    }
    return keys.length;
  }

  async getLifecycleRules(): Promise<LifecycleRule[]> {
    try {
      const response = await this.s3.send(
        new GetBucketLifecycleConfigurationCommand({
          Bucket: StorageHandler.DefaultBucketName(),
        })
      );
      return response.Rules ?? [];
    } catch (error) {
      if (
        (error as { name?: string }).name === 'NoSuchLifecycleConfiguration'
      ) {
        return [];
      }
      throw error;
    }
  }

  async setLifecycleRules(rules: LifecycleRule[]): Promise<void> {
    await this.s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: StorageHandler.DefaultBucketName(),
        LifecycleConfiguration: { Rules: rules },
      })
    );
  }

  async listMindmapObjects(): Promise<{ key: string; size: number }[]> {
    const results: { key: string; size: number }[] = [];
    let continuationToken: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: StorageHandler.DefaultBucketName(),
          Prefix: 'mindmaps/',
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of response.Contents ?? []) {
        if (obj.Key != null && obj.Size != null) {
          results.push({ key: obj.Key, size: obj.Size });
        }
      }
      continuationToken = response.NextContinuationToken;
      hasMore = Boolean(response.IsTruncated) && continuationToken != null;
    }
    return results;
  }
}

export default StorageHandler;
