import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONVERSION_SIGNAL_CODES } from './conversionSignalCodes';

function readServerSignalCodes(): string[] {
  const source = readFileSync(
    join(
      __dirname,
      '../../../../../',
      'src/services/NotionService/helpers/conversionTruncation.ts'
    ),
    'utf8'
  );
  return Array.from(
    source.matchAll(/export const [A-Z_]+_CODE = '([a-z_]+)';/g),
    (m) => m[1]
  );
}

describe('conversion signal code parity', () => {
  it('finds the server code constants it compares against', () => {
    expect(readServerSignalCodes().length).toBeGreaterThan(0);
  });

  it('the web vocabulary carries every code the server can emit', () => {
    const serverCodes = readServerSignalCodes();
    const webCodes = CONVERSION_SIGNAL_CODES as readonly string[];
    const missing = serverCodes.filter((code) => !webCodes.includes(code));
    expect(missing).toEqual([]);
  });

  it('declares no code the server does not emit', () => {
    const serverCodes = new Set(readServerSignalCodes());
    const extra = Array.from(CONVERSION_SIGNAL_CODES).filter(
      (code) => !serverCodes.has(code)
    );
    expect(extra).toEqual([]);
  });
});
