import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
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

const PLAN_DOCS = [
  'src/pages/DocsPage/content/help/limits.md',
  'src/pages/DocsPage/content/de/help/limits.md',
];

const PAID_PLANS = /paid plans|kostenpflichtigen Pläne/i;
const NOTION_SYNC = /Notion[ -]sync/i;

function sentencesGivingPlansSync(source: string): string[] {
  return source
    .split(/(?<=[.!?])\s+|\n/)
    .filter(
      (sentence) => PAID_PLANS.test(sentence) && NOTION_SYNC.test(sentence)
    );
}

const SYNC_LINK_TO_PRICING =
  /label:\s*'[^']*(?:sync|Synchronisierung)[^']*',\s*href:\s*'\/pricing\/?(?:[?#][^']*)?'/gi;

function syncLinksToPricing(source: string): string[] {
  return source.match(SYNC_LINK_TO_PRICING) ?? [];
}

const AUTO_SYNC_PRICING_LINK =
  /\/pricing\/?[?#][^\s'"`)<>]*auto[-_]?sync[^\s'"`)<>]*/gi;

function autoSyncPricingLinks(source: string): string[] {
  return source.match(AUTO_SYNC_PRICING_LINK) ?? [];
}

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|json|md|html|txt)$/;
const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$/;

function shippedFilesUnder(dir: string): string[] {
  return readdirSync(join(WEB_ROOT, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isFile() &&
        SOURCE_EXTENSIONS.test(entry.name) &&
        !TEST_FILE.test(entry.name)
    )
    .map((entry) => relative(WEB_ROOT, join(entry.parentPath, entry.name)));
}

const SHIPPED_SOURCES = [
  'index.html',
  'public/llms.txt',
  ...shippedFilesUnder('scripts'),
  ...shippedFilesUnder('src'),
];

const NOT_ON_SALE_EN =
  "Auto Sync isn't on sale right now, and it can't be switched on by request. Accounts that already have it keep it.";
const NOT_ON_SALE_DE =
  'Auto Sync ist gerade nicht erhältlich und wird auch nicht auf Anfrage freigeschaltet. Konten, die es schon haben, behalten es.';

const NOT_ON_SALE_DOCS: Array<[string, string]> = [
  ['src/pages/DocsPage/content/reference/plans.md', NOT_ON_SALE_EN],
  ['src/pages/DocsPage/content/help/limits.md', NOT_ON_SALE_EN],
  ['src/pages/DocsPage/content/sync/how-it-works.md', NOT_ON_SALE_EN],
  ['src/pages/DocsPage/content/de/reference/plans.md', NOT_ON_SALE_DE],
  ['src/pages/DocsPage/content/de/help/limits.md', NOT_ON_SALE_DE],
  ['src/pages/DocsPage/content/de/sync/how-it-works.md', NOT_ON_SALE_DE],
];

const OFFERS_BY_REQUEST =
  /switch it on|we'll turn it on|schalten es (?:für dein Konto )?frei|\|\s*(?:by request|auf Anfrage)\s*\|/i;

describe('docs wording while Auto Sync is not on sale', () => {
  it.each(NOT_ON_SALE_DOCS)(
    '%s says it is not on sale and not switched on by request',
    (path, sentence) => {
      const source = readFileSync(join(WEB_ROOT, path), 'utf-8');

      expect(source).toContain(sentence);
    }
  );

  it.each(NOT_ON_SALE_DOCS)(
    '%s offers no way to have it switched on',
    (path) => {
      const source = readFileSync(join(WEB_ROOT, path), 'utf-8');

      expect(source).not.toMatch(OFFERS_BY_REQUEST);
      expect(sentencesSellingAutoSync(source)).toEqual([]);
    }
  );

  it.each([
    'On any subscription, email support and we will switch it on for your account.',
    'Bei jedem Abo schreib eine E-Mail, und wir schalten es für dein Konto frei.',
    '| Auto Sync | — | by request |',
    '| Auto Sync | — | auf Anfrage |',
  ])('flags the old request offer %s, so the check can fail', (offer) => {
    expect(offer).toMatch(OFFERS_BY_REQUEST);
  });
});

describe('pricing links while Auto Sync is not on sale', () => {
  it('scans the shipped web sources, not an empty list', () => {
    expect(SHIPPED_SOURCES).toEqual(
      expect.arrayContaining([
        'index.html',
        'public/llms.txt',
        'scripts/prerenderLandingPages.ts',
        'src/pages/PricingPage/PricingPage.tsx',
        'src/pages/DocsPage/content/reference/plans.md',
        'src/lib/i18n/locales/en/marketing.json',
      ])
    );
    expect(SHIPPED_SOURCES).not.toContain(
      'src/pages/PricingPage/PricingPage.test.tsx'
    );
  });

  it('links nobody to an Auto Sync plan on the pricing page from any shipped source', () => {
    const found = SHIPPED_SOURCES.flatMap((path) =>
      autoSyncPricingLinks(readFileSync(join(WEB_ROOT, path), 'utf-8')).map(
        (link) => `${path}: ${link}`
      )
    );

    expect(found).toEqual([]);
  });

  it.each([
    ['/pricing?plan=auto-sync', "href: '/pricing?plan=auto-sync'"],
    ['/pricing#auto-sync', '<a href="/pricing#auto-sync">'],
    ['/pricing/?ref=home#auto-sync', "to: '/pricing/?ref=home#auto-sync'"],
    ['/pricing?upsell=autosync', '[see plans](/pricing?upsell=autosync)'],
  ])('flags %s, so the check can fail', (link, source) => {
    expect(autoSyncPricingLinks(source)).toEqual([link]);
  });

  it('leaves a plain pricing link alone', () => {
    expect(
      autoSyncPricingLinks("href: '/pricing?ref=notion-marketplace'")
    ).toEqual([]);
  });
});

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

  it('flags a sync link to pricing with a query string, so the check can fail', () => {
    expect(
      syncLinksToPricing(
        "{ label: 'Keep decks in sync with Notion', href: '/pricing?ref=home#plans' },"
      )
    ).toEqual([
      "label: 'Keep decks in sync with Notion', href: '/pricing?ref=home#plans'",
    ]);
  });

  it.each(MARKETING_SOURCES)('%s sends nobody to buy Auto Sync', (path) => {
    const source = readFileSync(join(WEB_ROOT, path), 'utf-8');

    expect(sentencesSellingAutoSync(source)).toEqual([]);
  });

  it.each(PLAN_DOCS)('%s says no paid plan adds Notion sync', (path) => {
    const source = readFileSync(join(WEB_ROOT, path), 'utf-8');

    expect(sentencesGivingPlansSync(source)).toEqual([]);
  });

  it('flags a sentence that gives a paid plan Notion sync, so the check can fail', () => {
    expect(
      sentencesGivingPlansSync(
        'Die kostenpflichtigen Pläne fügen größere Uploads und Notion-Sync hinzu. The paid plans add longer storage and Notion sync.'
      )
    ).toEqual([
      'Die kostenpflichtigen Pläne fügen größere Uploads und Notion-Sync hinzu.',
      'The paid plans add longer storage and Notion sync.',
    ]);
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
