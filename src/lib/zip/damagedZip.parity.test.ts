import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAMAGED_ZIP_MESSAGE } from './damagedZipMessage';

// My decks tells a damaged zip apart by matching this text in the job's
// failure reason, which stores the server message as is.
function readWebDamagedZipMarker(): string | undefined {
  const source = readFileSync(
    join(
      __dirname,
      '../../../web/src/pages/DownloadsPage/components/ConversionResult/ConversionResult.tsx'
    ),
    'utf8'
  );
  return /const DAMAGED_ZIP_MARKER = '([^']+)';/.exec(source)?.[1];
}

describe('damaged zip marker, server and web', () => {
  it('the web marker is still declared where the downloads page reads it', () => {
    expect(readWebDamagedZipMarker()).toEqual(expect.any(String));
  });

  it('the server message carries the web marker', () => {
    expect(DAMAGED_ZIP_MESSAGE).toContain(readWebDamagedZipMarker());
  });
});
