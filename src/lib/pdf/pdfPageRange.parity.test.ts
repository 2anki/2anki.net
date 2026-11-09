import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PdfPageRangeError, parsePdfPageRange } from './pdfPageRange';

// The downloads page tells a mistyped page range apart from a file that is too
// large by matching this text in the job's failure reason.
function readWebPageRangeMarker(): string | undefined {
  const source = readFileSync(
    join(
      __dirname,
      '../../../web/src/pages/DownloadsPage/components/ConversionResult/ConversionResult.tsx'
    ),
    'utf8'
  );
  return /const PDF_PAGE_RANGE_MARKER = '([^']+)';/.exec(source)?.[1];
}

function pageRangeErrorFor(raw: string): Error {
  try {
    parsePdfPageRange(raw);
  } catch (error) {
    return error as Error;
  }
  throw new Error(`parsePdfPageRange accepted ${raw}`);
}

describe('PDF page-range marker, server and web', () => {
  it('the web marker is still declared where the downloads page reads it', () => {
    expect(readWebPageRangeMarker()).toEqual(expect.any(String));
  });

  it.each(['1234567', '2-9999999'])(
    'the server message for %s carries the web marker',
    (raw) => {
      const error = pageRangeErrorFor(raw);

      expect(error).toBeInstanceOf(PdfPageRangeError);
      expect(error.message).toContain(readWebPageRangeMarker());
    }
  );
});
