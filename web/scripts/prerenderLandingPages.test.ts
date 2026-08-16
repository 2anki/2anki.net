import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitAnswersPages,
  emitLandingPages,
  emitMetaOnlyPages,
  emitNotionMarketplacePage,
} from './prerenderLandingPages';
import notionCopy from '../src/pages/LandingPage/copy/notion';
import { ANSWERS_PAGES } from '../src/pages/AnswersPage/answersConfig';

let buildDir: string;

const SOURCE_INDEX = `<!DOCTYPE html>
<html>
<head>
  <link rel="canonical" href="https://2anki.net" />
  <title>Create Anki Flashcards - 2anki.net</title>
  <meta name="description" content="Original description">
  <meta property="og:url" content="https://2anki.net:443">
  <meta property="og:type" content="website">
  <meta property="og:title" content="2anki.net">
  <meta property="og:description" content="Original og description">
  <meta property="og:image" content="https://2anki.net/notion2anki.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="2anki.net">
  <meta name="twitter:description" content="Original twitter description">
  <meta name="twitter:image" content="https://2anki.net/notion2anki.png">
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

const countMatches = (html: string, needle: string | RegExp): number => {
  if (needle instanceof RegExp) {
    return (html.match(needle) ?? []).length;
  }
  return html.split(needle).length - 1;
};

beforeEach(() => {
  buildDir = mkdtempSync(join(tmpdir(), '2anki-prerender-'));
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, 'index.html'), SOURCE_INDEX, 'utf8');
});

describe('emitLandingPages', () => {
  it('writes one HTML file per landing path', () => {
    const files = emitLandingPages(buildDir);
    expect(files).toHaveLength(41);
    expect(files.some((p) => p.endsWith('notion-to-anki/index.html'))).toBe(
      true
    );
    expect(files.some((p) => p.endsWith('anki-for-japanese/index.html'))).toBe(
      true
    );
    expect(files.some((p) => p.endsWith('quizlet-to-anki/index.html'))).toBe(
      true
    );
    expect(files.some((p) => p.endsWith('markdown-to-anki/index.html'))).toBe(
      true
    );
    expect(files.some((p) => p.endsWith('pdf-to-anki/index.html'))).toBe(true);
    expect(files.some((p) => p.endsWith('anki-to-notion/index.html'))).toBe(
      true
    );
    expect(files.some((p) => p.endsWith('usmle-anki/index.html'))).toBe(true);
    expect(files.some((p) => p.endsWith('step1-anki/index.html'))).toBe(true);
    expect(files.some((p) => p.endsWith('nclex-anki/index.html'))).toBe(true);
    expect(files.some((p) => p.endsWith('mcat-anki/index.html'))).toBe(true);
    expect(files.some((p) => p.endsWith('nursing-flashcards/index.html'))).toBe(
      true
    );
    expect(
      files.some((p) =>
        p.endsWith('anki-from-medical-lecture-slides/index.html')
      )
    ).toBe(true);
    expect(files.some((p) => p.endsWith('powerpoint-to-anki/index.html'))).toBe(
      true
    );
    expect(files.some((p) => p.endsWith('goodnotes-to-anki/index.html'))).toBe(
      true
    );
    expect(
      files.some((p) => p.endsWith('ai-flashcard-generator/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('convert/notion-to-anki/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('convert/pdf-to-anki/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('convert/markdown-to-anki/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('convert/csv-to-anki/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('convert/html-to-anki/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('convert/apkg-to-csv/index.html'))
    ).toBe(true);
  });

  it('replaces the title with the per-route title', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(`<title>${notionCopy.title}</title>`);
  });

  it('prerenders the fidelity-first title for the notion route', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(
      '<title>Notion to Anki — decks that open clean in Anki | 2anki</title>'
    );
  });

  it('does not prerender the client-rendered proof section body', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).not.toContain('What you actually get in Anki');
  });

  it('replaces the description with the per-route description', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(
      `<meta name="description" content="${notionCopy.description}">`
    );
  });

  it('points the canonical link at the route URL', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'pdf-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/pdf-to-anki/">'
    );
  });

  it('canonicalizes the /convert duplicates to the top-level slug', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'convert', 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/notion-to-anki/">'
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://2anki.net/convert/notion-to-anki/">'
    );
  });

  it('injects FAQPage JSON-LD into the prerendered head', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"FAQPage"');
  });

  it('inserts the H1 into the root div so bots without JS can index it', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(notionCopy.h1);
    expect(html).toContain('id="upload"');
  });

  it('adds OpenGraph and Twitter meta tags to the head', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('<meta property="og:description"');
    expect(html).toContain('<meta name="twitter:title"');
  });

  it('does not duplicate og:* or twitter:* tags from the source index', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(countMatches(html, /<meta\s+property="og:title"/g)).toBe(1);
    expect(countMatches(html, /<meta\s+property="og:description"/g)).toBe(1);
    expect(countMatches(html, /<meta\s+property="og:url"/g)).toBe(1);
    expect(countMatches(html, /<meta\s+property="og:type"/g)).toBe(1);
    expect(countMatches(html, /<meta\s+name="twitter:title"/g)).toBe(1);
    expect(countMatches(html, /<meta\s+name="twitter:description"/g)).toBe(1);
  });

  it('preserves og:image and twitter:card from the source index', () => {
    emitLandingPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain('<meta property="og:image"');
    expect(html).toContain('<meta name="twitter:card"');
  });
});

describe('emitMetaOnlyPages', () => {
  it('writes one HTML file per meta-only route', () => {
    const files = emitMetaOnlyPages(buildDir);
    expect(files.some((p) => p.endsWith('upload/index.html'))).toBe(true);
    expect(files.some((p) => p.endsWith('pricing/index.html'))).toBe(true);
    expect(files.some((p) => p.endsWith('about/index.html'))).toBe(true);
  });

  it('sets a unique title per route', () => {
    emitMetaOnlyPages(buildDir);
    const upload = readFileSync(join(buildDir, 'upload', 'index.html'), 'utf8');
    const pricing = readFileSync(
      join(buildDir, 'pricing', 'index.html'),
      'utf8'
    );
    const about = readFileSync(join(buildDir, 'about', 'index.html'), 'utf8');
    expect(upload).toContain(
      '<title>Upload notes and get an Anki deck — 2anki</title>'
    );
    expect(pricing).toContain(
      '<title>Pricing — Free, Day Pass, Unlimited, Lifetime | 2anki</title>'
    );
    expect(about).toContain(
      '<title>About 2anki — open-source Notion to Anki converter</title>'
    );
  });

  it('points the canonical link at the route URL', () => {
    emitMetaOnlyPages(buildDir);
    const html = readFileSync(join(buildDir, 'pricing', 'index.html'), 'utf8');
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/pricing/">'
    );
  });

  it('emits the /app native-app social meta', () => {
    const files = emitMetaOnlyPages(buildDir);
    expect(files.some((p) => p.endsWith('app/index.html'))).toBe(true);
    const html = readFileSync(join(buildDir, 'app', 'index.html'), 'utf8');
    expect(html).toContain(
      '<title>Anki flashcards on iPhone — 2anki app</title>'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/app/">'
    );
    expect(html).toContain('<meta property="og:title"');
  });

  it('leaves the root div empty so React mounts without a flash', () => {
    emitMetaOnlyPages(buildDir);
    const html = readFileSync(join(buildDir, 'upload', 'index.html'), 'utf8');
    expect(html).toContain('<div id="root"></div>');
  });

  it('does not duplicate og:* tags from the source index', () => {
    emitMetaOnlyPages(buildDir);
    const html = readFileSync(join(buildDir, 'upload', 'index.html'), 'utf8');
    expect(countMatches(html, /<meta\s+property="og:title"/g)).toBe(1);
    expect(countMatches(html, /<meta\s+property="og:url"/g)).toBe(1);
    expect(countMatches(html, /<meta\s+name="twitter:title"/g)).toBe(1);
  });
});

describe('emitNotionMarketplacePage', () => {
  it('writes a unique title and canonical', () => {
    emitNotionMarketplacePage(buildDir);
    const html = readFileSync(
      join(buildDir, 'notion-marketplace', 'index.html'),
      'utf8'
    );
    expect(html).toContain(
      '<title>Notion to Anki — automatic sync | 2anki</title>'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/notion-marketplace/">'
    );
    expect(html).toContain('Your Notion notes become Anki cards');
  });
});

describe('emitAnswersPages', () => {
  it('writes one HTML file per answers slug', () => {
    const files = emitAnswersPages(buildDir);
    expect(files).toHaveLength(ANSWERS_PAGES.size);
    expect(
      files.some((p) => p.endsWith('answers/convert-notion-to-anki/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('answers/notion-to-anki-sync/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('answers/pdf-to-anki/index.html'))
    ).toBe(true);
    expect(
      files.some((p) => p.endsWith('answers/quizlet-to-anki/index.html'))
    ).toBe(true);
  });

  it('sets the title for each answers page', () => {
    emitAnswersPages(buildDir);
    const config = ANSWERS_PAGES.get('convert-notion-to-anki')!;
    const html = readFileSync(
      join(buildDir, 'answers', 'convert-notion-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(`<title>${config.title}</title>`);
  });

  it('sets the canonical link to the answers path', () => {
    emitAnswersPages(buildDir);
    const html = readFileSync(
      join(buildDir, 'answers', 'pdf-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://2anki.net/answers/pdf-to-anki/">'
    );
  });

  it('injects the h1 into the root div', () => {
    emitAnswersPages(buildDir);
    const config = ANSWERS_PAGES.get('quizlet-to-anki')!;
    const html = readFileSync(
      join(buildDir, 'answers', 'quizlet-to-anki', 'index.html'),
      'utf8'
    );
    expect(html).toContain(config.h1);
  });
});
