import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB_ROOT = join(__dirname, '../../..');
const SCANNED_SOURCE_EXTENSIONS = /\.(ts|tsx|md)$/;
const SKIPPED_FILES = /\.test\.(ts|tsx)$/;

const FALSE_CLAIMS: Array<{ claim: RegExp; why: string }> = [
  {
    claim: /files?\s+of\s+any\s+size/i,
    why: 'free and paid uploads are capped at 100 MB and 10 GB',
  },
  {
    claim: /no\s+message\s+cap/i,
    why: 'chat messages use AI credits',
  },
  {
    claim: /paid\s+plans?\s+convert\s+without\s+limits/i,
    why: 'photos and chat draw on AI credits',
  },
  {
    claim: /bezahlte\s+Pläne\s+konvertieren\s+ohne\s+Limits/i,
    why: 'photos and chat draw on AI credits',
  },
  {
    claim: /unlimited\s+flashcards,\s+PDF support/i,
    why: 'AI conversion runs on a monthly credit allowance, so do not bundle it with unlimited',
  },
  {
    claim: /unlimited\s+cards,\s+PDF support/i,
    why: 'name the monthly card limit and the AI credits instead',
  },
  {
    claim: /Pro\s+removes\s+the\s+cap\s+and\s+adds\s+the\s+multiple-choice/i,
    why: 'photo-to-deck is capped at 5 free photos and paid photos use AI credits',
  },
  {
    claim: /\|\s*Nachrichten[^|]*\|[^|]*\|\s*Unbegrenzt/i,
    why: 'chat messages use AI credits',
  },
  {
    claim: /Subscription\s+and\s+Lifetime\s+remove\s+the\s+cap/i,
    why: 'the image occlusion build accepts up to 20 uploaded images at a time',
  },
  {
    claim: /paid\s+plans?\s+lift\s+the\s+(size\s+)?limit\b/i,
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
