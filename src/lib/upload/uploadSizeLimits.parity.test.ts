import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FREE_USER_MAX_UPLOAD_SIZE,
  PAYING_MAX_UPLOAD_SIZE,
} from '../misc/getUploadLimits';
import {
  APKG_TOOL_MAX_UPLOAD_BYTES,
  PDF_UNLOCK_MAX_UPLOAD_BYTES,
  THIN_DECK_PREVIEW_MAX_UPLOAD_BYTES,
} from './uploadSizeLimits';

const MIB = 1024 * 1024;

const WEB_LIMITS_PATH = join(
  __dirname,
  '../../../web/src/lib/upload/uploadSizeLimits.ts'
);

async function readWebLimit(name: string): Promise<unknown> {
  const webLimits: Record<string, unknown> = await import(WEB_LIMITS_PATH);
  return webLimits[name];
}

describe('upload size limits, server and web', () => {
  it.each([
    ['UPLOAD_FILE_FREE_MAX_BYTES', FREE_USER_MAX_UPLOAD_SIZE],
    ['UPLOAD_FILE_PAYING_MAX_BYTES', PAYING_MAX_UPLOAD_SIZE],
    ['PDF_UNLOCK_MAX_BYTES', PDF_UNLOCK_MAX_UPLOAD_BYTES],
    ['THIN_DECK_PREVIEW_MAX_BYTES', THIN_DECK_PREVIEW_MAX_UPLOAD_BYTES],
    ['APKG_TOOL_MAX_BYTES', APKG_TOOL_MAX_UPLOAD_BYTES],
  ])('the web refuses above %s, the multer limit', async (name, limit) => {
    expect(await readWebLimit(name)).toBe(limit);
  });

  it.each([
    ['free /api/upload/file', FREE_USER_MAX_UPLOAD_SIZE, 100 * MIB],
    ['paying /api/upload/file', PAYING_MAX_UPLOAD_SIZE, 10_000 * MIB],
    [
      '/api/upload/retry-with-credential',
      PDF_UNLOCK_MAX_UPLOAD_BYTES,
      50 * MIB,
    ],
    [
      '/api/upload/thin-deck-preview',
      THIN_DECK_PREVIEW_MAX_UPLOAD_BYTES,
      50 * MIB,
    ],
    [
      '/api/apkg/pdf, pdf/preview and csv',
      APKG_TOOL_MAX_UPLOAD_BYTES,
      100 * MIB,
    ],
  ])('keeps the %s limit the server has today', (_route, limit, bytes) => {
    expect(limit).toBe(bytes);
  });
});
