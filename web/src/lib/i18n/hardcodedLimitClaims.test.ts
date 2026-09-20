import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB_ROOT = join(__dirname, '../../..');
const SCANNED_SOURCE_EXTENSIONS = /\.(ts|tsx|md)$/;
const SKIPPED_FILES = /\.test\.(ts|tsx)$/;

const FALSE_CLAIMS: Array<{ claim: RegExp; why: string }> = [
  {
    claim: /files? of any size/i,
    why: 'free and paid uploads are capped at 100 MB and 10 GB',
  },
  {
    claim: /no message cap/i,
    why: 'chat messages use AI credits',
  },
  {
    claim: /paid plans? convert without limits/i,
    why: 'photos and chat draw on AI credits',
  },
  {
    claim: /bezahlte Pläne konvertieren ohne Limits/i,
    why: 'photos and chat draw on AI credits',
  },
  {
    claim: /unlimited AI conversion/i,
    why: 'AI features run on a monthly credit allowance',
  },
  {
    claim: /paid plans lift the (size )?limit\b/i,
    why: 'say what paid plans raise the limit to, or that they use AI credits',
  },
];

function listSourceFiles(): string[] {
  const inSrc = readdirSync(join(WEB_ROOT, 'src'), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        SCANNED_SOURCE_EXTENSIONS.test(file) && !SKIPPED_FILES.test(file)
    );
  return [
    ...inSrc,
    join(WEB_ROOT, 'index.html'),
    join(WEB_ROOT, 'public/llms.txt'),
  ];
}

describe('hardcoded limit claims', () => {
  it('no page, doc, structured data or llms.txt string makes a claim the code does not back', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const { claim, why } of FALSE_CLAIMS) {
        if (claim.test(text)) {
          offenders.push(`${relative(WEB_ROOT, file)}: ${claim} (${why})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
