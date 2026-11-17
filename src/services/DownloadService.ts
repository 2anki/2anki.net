import StorageHandler, {
  type StoredObjectStream,
} from '../lib/storage/StorageHandler';
import DownloadRepository from '../data_layer/DownloadRepository';
import { anonRecoveryKey } from '../lib/upload/anonymousRecovery';
import {
  ApkgTooLargeError,
  MAX_TOTAL_DECOMPRESSED_BYTES,
} from './ApkgPreviewService/extractApkg';

const HEAD_MISSING_NAME = 'NotFound';

const TRANSIENT_ERROR_NAMES = new Set([
  'TimeoutError',
  'RequestTimeout',
  'RequestTimeoutException',
  'ServiceUnavailable',
  'SlowDown',
  'InternalError',
  'PriorRequestNotComplete',
]);

const TRANSIENT_SOCKET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'ENOTFOUND',
]);

function getErrorName(error: unknown): string | undefined {
  return (error as { name?: string })?.name;
}

function getStorageStatusCode(error: unknown): number | undefined {
  const metadata = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata;
  return typeof metadata?.httpStatusCode === 'number'
    ? metadata.httpStatusCode
    : undefined;
}

function getSocketCode(error: unknown): string | undefined {
  const direct = (error as { code?: string })?.code;
  if (typeof direct === 'string') return direct;
  const nested = (error as { cause?: { code?: string } })?.cause?.code;
  return typeof nested === 'string' ? nested : undefined;
}

class DownloadService {
  constructor(private downloadRepository: DownloadRepository) {}

  async getFileBody(
    owner: string,
    key: string,
    storage: StorageHandler
  ): Promise<Buffer | null | undefined> {
    const storageKey = await this.findStoredKey(owner, key);
    if (storageKey == null) {
      return null;
    }
    return this.getStoredDeckBody(storageKey, storage);
  }

  async findStoredKey(owner: string, key: string): Promise<string | null> {
    const fileEntry = await this.downloadRepository.getFile(owner, key);
    return fileEntry?.key ?? null;
  }

  async getStoredDeckBody(
    storageKey: string,
    storage: StorageHandler
  ): Promise<Buffer | undefined> {
    await this.assertReadableSize(storageKey, storage);
    return this.readStoredBody(storageKey, storage);
  }

  async assertReadableSize(
    storageKey: string,
    storage: StorageHandler
  ): Promise<void> {
    if (await this.isTooLargeToRead(storageKey, storage)) {
      console.info('[apkg-preview] stored deck refused before read: too large');
      throw new ApkgTooLargeError();
    }
  }

  async readStoredBody(
    storageKey: string,
    storage: StorageHandler
  ): Promise<Buffer | undefined> {
    const file = await storage.getFileContents(storageKey);
    return file?.Body;
  }

  async isTooLargeToRead(
    storageKey: string,
    storage: StorageHandler
  ): Promise<boolean> {
    const size = await storage.getObjectSize(storageKey);
    return size == null || size > MAX_TOTAL_DECOMPRESSED_BYTES;
  }

  async getFileStream(
    owner: string,
    key: string,
    storage: StorageHandler
  ): Promise<StoredObjectStream | null | undefined> {
    const fileEntry = await this.downloadRepository.getFile(owner, key);
    if (!fileEntry) {
      return null;
    }
    return storage.getFileStream(fileEntry.key);
  }

  getAnonymousRecoveryStream(
    anonId: string,
    token: string,
    storage: StorageHandler
  ): Promise<StoredObjectStream | undefined> {
    return storage.getFileStream(anonRecoveryKey(anonId, token));
  }

  async getFilename(owner: string, key: string): Promise<string | null> {
    return this.downloadRepository.getFilename(owner, key);
  }

  isValidKey(key: string) {
    return key && key.length > 0;
  }

  isMissingDownloadError(error: unknown) {
    const errorName = getErrorName(error);
    if (errorName == null) return false;
    return errorName.includes('NoSuchKey') || errorName === HEAD_MISSING_NAME;
  }

  isTransientStorageError(error: unknown) {
    if (this.isMissingDownloadError(error)) return false;
    const statusCode = getStorageStatusCode(error);
    if (statusCode != null && statusCode >= 500) return true;
    const errorName = getErrorName(error);
    if (errorName != null && TRANSIENT_ERROR_NAMES.has(errorName)) return true;
    const socketCode = getSocketCode(error);
    return socketCode != null && TRANSIENT_SOCKET_CODES.has(socketCode);
  }

  deleteMissingFile(owner: string, key: string) {
    this.downloadRepository.deleteMissingFile(owner, key);
  }
}

export default DownloadService;
