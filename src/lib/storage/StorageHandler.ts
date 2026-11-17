import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import { normalizeS3Endpoint } from './normalizeS3Endpoint';
import { buildContentDisposition } from '../buildContentDisposition';
import { getSafeFilename } from '../getSafeFilename';

export interface StoredObject {
  Body: Buffer | undefined;
}

export interface StoredObjectStream {
  body: Readable;
  contentLength: number | undefined;
}

export class StorageReadAbortedError extends Error {
  constructor() {
    super('The storage read was stopped.');
    this.name = 'StorageReadAbortedError';
  }
}

interface DrainableBody {
  transformToByteArray: () => Promise<Uint8Array>;
}

function destroyBody(body: DrainableBody): void {
  const stream = body as unknown as Partial<Readable>;
  if (typeof stream.destroy === 'function') stream.destroy();
}

// The signal on send stops the request; a body that stops arriving after the
// headers is only released by destroying its stream.
function readBodyUntilAborted(
  body: DrainableBody,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (signal.aborted) {
    destroyBody(body);
    return Promise.reject(new StorageReadAbortedError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      destroyBody(body);
      reject(new StorageReadAbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    body
      .transformToByteArray()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
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

  async getFileContents(
    key: string,
    signal?: AbortSignal
  ): Promise<StoredObject> {
    const command = new GetObjectCommand({
      Bucket: StorageHandler.DefaultBucketName(),
      Key: key,
    });
    const response =
      signal == null
        ? await this.s3.send(command)
        : await this.s3.send(command, { abortSignal: signal });
    if (response.Body == null) {
      return { Body: undefined };
    }
    const bytes =
      signal == null
        ? await response.Body.transformToByteArray()
        : await readBodyUntilAborted(response.Body, signal);
    return { Body: Buffer.from(bytes) };
  }

  // getFileContents reads the whole object into memory; use this for large
  // objects. In Node the SDK's Body is already a Readable, so the caller can
  // pipe it straight to the response.
  async getFileStream(key: string): Promise<StoredObjectStream | undefined> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: StorageHandler.DefaultBucketName(),
        Key: key,
      })
    );
    const body = response.Body as unknown as Readable | undefined;
    if (body == null || typeof body.pipe !== 'function') {
      return undefined;
    }
    return { body, contentLength: response.ContentLength };
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

  async getObjectSize(key: string): Promise<number | undefined> {
    const response = await this.s3.send(
      new HeadObjectCommand({
        Bucket: StorageHandler.DefaultBucketName(),
        Key: key,
      })
    );
    return response.ContentLength;
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
    const objects = await this.listObjectsByPrefix(prefix);
    return objects.map((obj) => obj.Key);
  }

  async listObjectsByPrefix(
    prefix: string
  ): Promise<{ Key: string; LastModified?: Date }[]> {
    const objects: { Key: string; LastModified?: Date }[] = [];
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
        if (obj.Key != null) {
          objects.push({ Key: obj.Key, LastModified: obj.LastModified });
        }
      }
      continuationToken = response.NextContinuationToken;
      hasMore = Boolean(response.IsTruncated) && continuationToken != null;
    }
    return objects;
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
