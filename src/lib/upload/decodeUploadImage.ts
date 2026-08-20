import imageSize from 'image-size';

import { detectFileMime } from '../detectFileMime';
import type { VisionMediaType } from '../claude/countVisionTokens';

const VISION_MEDIA_TYPES: VisionMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export interface DecodedUploadImage {
  imageBase64: string;
  mediaType: VisionMediaType;
  width: number;
  height: number;
}

function isVisionMediaType(value: string | null): value is VisionMediaType {
  return value != null && (VISION_MEDIA_TYPES as string[]).includes(value);
}

export function decodeUploadImage(buffer: Buffer): DecodedUploadImage | null {
  if (buffer.length === 0) {
    return null;
  }
  const mediaType = detectFileMime(buffer);
  if (!isVisionMediaType(mediaType)) {
    return null;
  }
  let width: number | undefined;
  let height: number | undefined;
  try {
    const dims = imageSize(buffer);
    width = dims.width;
    height = dims.height;
  } catch {
    return null;
  }
  if (width == null || height == null) {
    return null;
  }
  return {
    imageBase64: buffer.toString('base64'),
    mediaType,
    width,
    height,
  };
}
