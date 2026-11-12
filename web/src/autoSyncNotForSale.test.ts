import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(__dirname, '..');
const LANDING_COPY_DIR = join(WEB_ROOT, 'src/pages/LandingPage/copy');

const MARKETING_SOURCES = [
  'public/llms.txt',
  'scripts/prerenderLandingPages.ts',
  'src/pages/AnswersPage/answersConfig.ts',
  'src/pages/ConvertLandingPage/convertLandingConfig.ts',
  'src/pages/DocsPage/content/start-here/what-is-2anki.md',
  'src/pages/DocsPage/content/de/start-here/what-is-2anki.md',
  ...readdirSync(LANDING_COPY_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => `src/pages/LandingPage/copy/${name}`),
];

const SELLING_WORDS =
  /pricing|Preisseite|monthly plan|included with Lifetime|Get Auto Sync|plans remove the cap/i;

function sentencesSellingAutoSync(source: string): string[] {
  return source
    .split(/(?<=[.!?])\s+|\n/)
    .filter(
      (sentence) =>
        /Auto[ -]?Sync/i.test(sentence) && SELLING_WORDS.test(sentence)
    );
}

const SYNC_LINK_TO_PRICING =
  /label:\s*'[^']*(?:sync|Synchronisierung)[^']*',\s*href:\s*'\/pricing\/?'/gi;

function syncLinksToPricing(source: string): string[] {
  return source.match(SYNC_LINK_TO_PRICING) ?? [];
}

describe('marketing copy while Auto Sync is not on sale', () => {
  it.each(MARKETING_SOURCES)(
    '%s links no sync promise to the pricing page',
    (path) => {
      const source = readFileSync(join(WEB_ROOT, path), 'utf-8');

      expect(syncLinksToPricing(source)).toEqual([]);
    }
  );

  it('flags a sync link to pricing, so the check can fail', () => {
    expect(
      syncLinksToPricing(
        "{ label: 'Keep decks in sync with Notion', href: '/pricing' },"
      )
    ).toEqual(["label: 'Keep decks in sync with Notion', href: '/pricing'"]);
  });

  it.each(MARKETING_SOURCES)('%s sends nobody to buy Auto Sync', (path) => {
    const source = readFileSync(join(WEB_ROOT, path), 'utf-8');

    expect(sentencesSellingAutoSync(source)).toEqual([]);
  });

  it('flags a sentence that sells it, so the check can fail', () => {
    expect(
      sentencesSellingAutoSync(
        'Re-paste the link. If you want changes to flow, see Auto Sync on the pricing page.'
      )
    ).toEqual([
      'If you want changes to flow, see Auto Sync on the pricing page.',
    ]);
  });
});
