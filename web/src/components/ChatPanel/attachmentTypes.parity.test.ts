import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_ATTACHMENT_TYPES } from './attachmentTypes';

const MIME_LITERAL = /'([a-z]+\/[a-zA-Z0-9.+-]+)'/g;

function readServerSource(relativePath: string): string {
  return readFileSync(join(__dirname, '../../../../', relativePath), 'utf8');
}

// ALLOWED_MIMES in ChatController is BINARY_VERIFIED_MIMES plus ZIP_BASED_MIMES
// plus TEXT_MIMES, and the last two are built from constants that live in
// extractAttachmentText. Reading the whole controller instead would also pick up
// unrelated content types such as text/event-stream.
function readServerAllowedMimes(): Set<string> {
  const controller = readServerSource('src/controllers/ChatController.ts');
  const binaryBlock =
    /const BINARY_VERIFIED_MIMES = new Set\(\[([^\]]*)\]/.exec(controller);
  if (binaryBlock == null) {
    throw new Error('BINARY_VERIFIED_MIMES not found in ChatController');
  }

  const extract = readServerSource(
    'src/usecases/chat/extractAttachmentText.ts'
  );
  const textExtractableBlock =
    /export const TEXT_EXTRACTABLE_MIMES = new Set<string>\(\[([^\]]*)\]/.exec(
      extract
    );
  if (textExtractableBlock == null) {
    throw new Error(
      'TEXT_EXTRACTABLE_MIMES not found in extractAttachmentText'
    );
  }
  const namedConstants = Array.from(
    textExtractableBlock[1].matchAll(/([A-Z_]+),/g),
    (m) => m[1]
  );

  const mimes = new Set(
    Array.from(binaryBlock[1].matchAll(MIME_LITERAL), (m) => m[1])
  );
  for (const name of namedConstants) {
    const declaration = new RegExp(
      `export const ${name} =\\s*'([a-z]+\\/[a-zA-Z0-9.+-]+)'`
    ).exec(extract);
    if (declaration == null) {
      throw new Error(`${name} has no literal in extractAttachmentText`);
    }
    mimes.add(declaration[1]);
  }
  return mimes;
}

describe('chat attachment type parity', () => {
  it('every type the picker offers is one the server accepts', () => {
    const serverMimes = readServerAllowedMimes();
    const missing = Array.from(ALLOWED_ATTACHMENT_TYPES).filter(
      (type) => !serverMimes.has(type)
    );
    expect(missing).toEqual([]);
  });

  it('offers every type the server accepts', () => {
    const serverMimes = readServerAllowedMimes();
    const unofferable = Array.from(serverMimes).filter(
      (type) => !ALLOWED_ATTACHMENT_TYPES.has(type)
    );
    expect(unofferable).toEqual([]);
  });
});
