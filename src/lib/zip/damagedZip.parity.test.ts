import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAMAGED_ZIP_MESSAGE } from './damagedZipMessage';
import { RECOVERY_TOO_LARGE_MESSAGE } from './fallback/ZipRecoveryTooLargeError';
import { INCOMPLETE_ZIP_MESSAGE } from './zip';

// My decks tells a damaged zip apart by matching this text in the job's
// failure reason, which stores the server message as is.
function readWebMarker(name: string): string | undefined {
  const source = readFileSync(
    join(
      __dirname,
      '../../../web/src/pages/DownloadsPage/components/ConversionResult/ConversionResult.tsx'
    ),
    'utf8'
  );
  return new RegExp(`const ${name} = '([^']+)';`).exec(source)?.[1];
}

describe('damaged zip marker, server and web', () => {
  it.each([
    ['DAMAGED_ZIP_MARKER', DAMAGED_ZIP_MESSAGE],
    ['INCOMPLETE_ZIP_MARKER', INCOMPLETE_ZIP_MESSAGE],
    ['ZIP_TOO_LARGE_MARKER', RECOVERY_TOO_LARGE_MESSAGE],
  ])('the server message carries the web marker %s', (name, message) => {
    expect(readWebMarker(name)).toEqual(expect.any(String));
    expect(message).toContain(readWebMarker(name));
  });
});
