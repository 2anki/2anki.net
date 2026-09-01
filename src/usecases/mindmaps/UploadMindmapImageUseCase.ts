import { randomUUID } from 'node:crypto';

import imageSize from 'image-size';

import StorageHandler from '../../lib/storage/StorageHandler';
import { HttpCodedError } from '../../lib/errors/HttpCodedError';
import { detectFileMime } from '../../lib/detectFileMime';

export const MINDMAP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export class MindmapImageTooLargeError extends HttpCodedError {
  constructor() {
    super('Image exceeds the 5 MB limit', 413, 'too_large');
  }
}

export class MindmapImageTypeError extends HttpCodedError {
  constructor() {
    super(
      'Only PNG, JPEG, GIF, and WebP images are accepted',
      415,
      'unsupported_format'
    );
  }
}

interface UploadInput {
  userId: string;
  mapId: string;
  file: {
    buffer: Buffer;
    size: number;
  };
}

export interface MindmapImageResult {
  s3Key: string;
  presignedUrl: string;
  width: number;
  height: number;
}

export class UploadMindmapImageUseCase {
  constructor(private readonly storage: StorageHandler) {}

  async execute(input: UploadInput): Promise<MindmapImageResult> {
    const { userId, mapId, file } = input;

    if (file.size > MINDMAP_IMAGE_MAX_BYTES) {
      throw new MindmapImageTooLargeError();
    }

    const detectedType = detectFileMime(file.buffer);
    if (detectedType == null || !ALLOWED_MIME_TYPES.has(detectedType)) {
      throw new MindmapImageTypeError();
    }

    const ext = this.extensionFor(detectedType);
    const s3Key = `mindmaps/${userId}/${mapId}/${randomUUID()}${ext}`;

    await this.storage.uploadFile(s3Key, file.buffer);

    const dims = imageSize(file.buffer);
    const presignedUrl = await this.storage.getPresignedUrl(s3Key);

    return {
      s3Key,
      presignedUrl,
      width: dims.width ?? 0,
      height: dims.height ?? 0,
    };
  }

  private extensionFor(mimetype: string): string {
    switch (mimetype) {
      case 'image/png':
        return '.png';
      case 'image/jpeg':
        return '.jpg';
      case 'image/gif':
        return '.gif';
      case 'image/webp':
        return '.webp';
      default:
        return '.bin';
    }
  }
}
