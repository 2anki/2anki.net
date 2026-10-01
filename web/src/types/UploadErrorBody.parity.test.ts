import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UPLOAD_ERROR_CODES } from './UploadErrorBody';

function readServerUploadErrorCodes(): string[] {
  const source = readFileSync(
    join(__dirname, '../../../', 'src/types/UploadErrorBody.ts'),
    'utf8'
  );
  const union = /export type UploadErrorCode =([\s\S]*?);/.exec(source);
  if (union == null) {
    throw new Error('UploadErrorCode union not found in server source');
  }
  return Array.from(union[1].matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

describe('UploadErrorCode parity', () => {
  it('the web codes list carries every code the server union declares', () => {
    const serverCodes = readServerUploadErrorCodes();
    const missing = serverCodes.filter(
      (code) => !(UPLOAD_ERROR_CODES as readonly string[]).includes(code)
    );
    expect(missing).toEqual([]);
  });

  it('declares no code the server union does not', () => {
    const serverCodes = new Set(readServerUploadErrorCodes());
    const extra = Array.from(UPLOAD_ERROR_CODES).filter(
      (code) => !serverCodes.has(code)
    );
    expect(extra).toEqual([]);
  });
});
