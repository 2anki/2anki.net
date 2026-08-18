import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import notionCopy from '../src/pages/LandingPage/copy/notion';
import quizletCopy from '../src/pages/LandingPage/copy/quizlet';
import markdownCopy from '../src/pages/LandingPage/copy/markdown';
import pdfCopy from '../src/pages/LandingPage/copy/pdf';
import ankiToNotionCopy from '../src/pages/LandingPage/copy/ankiToNotion';
import usmleCopy from '../src/pages/LandingPage/copy/usmle';
import step1Copy from '../src/pages/LandingPage/copy/step1';
import nclexCopy from '../src/pages/LandingPage/copy/nclex';
import mcatCopy from '../src/pages/LandingPage/copy/mcat';
import nursingCopy from '../src/pages/LandingPage/copy/nursing';
import japaneseCopy from '../src/pages/LandingPage/copy/japanese';
import medicalLectureSlidesCopy from '../src/pages/LandingPage/copy/medical-lecture-slides';
import powerpointCopy from '../src/pages/LandingPage/copy/powerpoint';
import goodnotesCopy from '../src/pages/LandingPage/copy/goodnotes';
import aiFlashcardGeneratorCopy from '../src/pages/LandingPage/copy/ai-flashcard-generator';
import { CONVERT_LANDING_PAGES } from '../src/pages/ConvertLandingPage/convertLandingConfig';
import { ANSWERS_PAGES } from '../src/pages/AnswersPage/answersConfig';
import {
  buildArticleJsonLd,
  buildFaqJsonLd,
} from '../src/pages/AnswersPage/answersJsonLd';
import { buildFaqJsonLd as buildLandingFaqJsonLd } from '../src/pages/LandingPage/landingJsonLd';
import type { LandingCopy } from '../src/pages/LandingPage/types';
import { canonicalUrl } from '../src/lib/seo/canonicalUrl';

const LANDING_COPIES: LandingCopy[] = [
  notionCopy,
  quizletCopy,
  markdownCopy,
  pdfCopy,
  ankiToNotionCopy,
  usmleCopy,
  step1Copy,
  nclexCopy,
  mcatCopy,
  nursingCopy,
  japaneseCopy,
  medicalLectureSlidesCopy,
  powerpointCopy,
  goodnotesCopy,
  aiFlashcardGeneratorCopy,
  ...Array.from(CONVERT_LANDING_PAGES.values()),
];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function buildHeroFragment(copy: LandingCopy): string {
  return [
    '<section id="upload" style="background:var(--color-bg-secondary);padding:4rem 1.5rem 3rem;">',
    '<div style="max-width:640px;margin:0 auto;">',
    `<h1 style="font-family:var(--font-display);font-size:clamp(2.25rem, 6vw, 3.5rem);font-weight:var(--font-bold);letter-spacing:-0.03em;line-height:1.1;color:var(--color-text-primary);margin:0 0 1rem;max-width:16ch;">${escapeHtml(
      copy.h1
    )}</h1>`,
    `<p style="font-size:var(--text-lg);color:var(--color-text-secondary);margin:0 0 2rem;line-height:var(--leading-relaxed);max-width:42ch;">${escapeHtml(
      copy.subhead
    )}</p>`,
    '</div>',
    '</section>',
  ].join('');
}

const REPLACED_OG_PROPERTIES = [
  'og:title',
  'og:description',
  'og:url',
  'og:type',
];
const REPLACED_TWITTER_NAMES = ['twitter:title', 'twitter:description'];

function stripExistingMeta(html: string): string {
  let next = html;
  for (const property of REPLACED_OG_PROPERTIES) {
    const pattern = new RegExp(
      `\\s*<meta\\s+property="${property}"[^>]*>`,
      'g'
    );
    next = next.replace(pattern, '');
  }
  for (const name of REPLACED_TWITTER_NAMES) {
    const pattern = new RegExp(`\\s*<meta\\s+name="${name}"[^>]*>`, 'g');
    next = next.replace(pattern, '');
  }
  return next;
}

function rewriteHead(html: string, copy: LandingCopy): string {
  const canonical = canonicalUrl(copy.canonicalPathname ?? copy.pathname);
  const pageUrl = canonicalUrl(copy.pathname);
  const titleTag = `<title>${escapeHtml(copy.title)}</title>`;
  const descriptionTag = `<meta name="description" content="${escapeHtml(
    copy.description
  )}">`;
  const ogTags = [
    `<meta property="og:title" content="${escapeHtml(copy.title)}">`,
    `<meta property="og:description" content="${escapeHtml(
      copy.description
    )}">`,
    `<meta property="og:url" content="${pageUrl}">`,
    '<meta property="og:type" content="website">',
    `<meta name="twitter:title" content="${escapeHtml(copy.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(
      copy.description
    )}">`,
  ].join('\n  ');

  let next = html.replace(/<title>[\s\S]*?<\/title>/, titleTag);
  next = next.replace(/<meta\s+name="description"[^>]*>/, descriptionTag);
  next = next.replace(
    /<link\s+rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${canonical}">`
  );
  next = stripExistingMeta(next);
  next = next.replace(/<\/head>/, `  ${ogTags}\n</head>`);
  return next;
}

function rewriteRoot(html: string, copy: LandingCopy): string {
  const hero = buildHeroFragment(copy);
  return html.replace(/<div id="root"><\/div>/, `<div id="root">${hero}</div>`);
}

const NOTION_MARKETPLACE_META = {
  pathname: '/notion-marketplace',
  title: 'Notion to Anki — automatic sync | 2anki',
  description:
    'Connect your Notion workspace and your notes become Anki flashcards automatically. No exports, no zips. Included with Unlimited at $7.99/mo.',
  h1: 'Your Notion notes become Anki cards — automatically',
  subhead:
    'Connect your workspace in 5 minutes. No exports, no zips, no manual steps.',
};

function buildNotionMarketplaceFragment(): string {
  return [
    '<section style="padding:4rem 1.5rem 3rem;text-align:center;">',
    '<div style="max-width:720px;margin:0 auto;">',
    `<h1 style="font-family:var(--font-display);margin:0 0 1rem;font-size:2.5rem;font-weight:700;max-width:20ch;margin-left:auto;margin-right:auto;">${escapeHtml(NOTION_MARKETPLACE_META.h1)}</h1>`,
    `<p style="margin:0 0 2rem;color:var(--color-text-secondary);font-size:1.125rem;">${escapeHtml(NOTION_MARKETPLACE_META.subhead)}</p>`,
    '</div>',
    '</section>',
  ].join('');
}

export function emitNotionMarketplacePage(buildDir: string): string {
  const meta = NOTION_MARKETPLACE_META;
  const indexPath = join(buildDir, 'index.html');
  const source = readFileSync(indexPath, 'utf8');
  const canonical = canonicalUrl(meta.pathname);
  const slug = meta.pathname.replace(/^\//, '');
  const outDir = join(buildDir, slug);
  const outPath = join(outDir, 'index.html');
  mkdirSync(dirname(outPath), { recursive: true });

  const titleTag = `<title>${escapeHtml(meta.title)}</title>`;
  const descriptionTag = `<meta name="description" content="${escapeHtml(meta.description)}">`;
  const ogTags = [
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${canonical}">`,
    '<meta property="og:type" content="website">',
  ].join('\n  ');

  let html = source.replace(/<title>[\s\S]*?<\/title>/, titleTag);
  html = html.replace(/<meta\s+name="description"[^>]*>/, descriptionTag);
  html = html.replace(
    /<link\s+rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${canonical}">`
  );
  html = stripExistingMeta(html);
  html = html.replace(/<\/head>/, `  ${ogTags}\n</head>`);
  html = html.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${buildNotionMarketplaceFragment()}</div>`
  );

  writeFileSync(outPath, html, 'utf8');
  return outPath;
}

const CONVERT_HUB_META = {
  pathname: '/convert',
  title: 'Convert anything to Anki — every converter | 2anki',
  description:
    'Browse every 2anki converter in one place. Turn Notion, Markdown, PDF, CSV, Quizlet, Brainscape, Pleco, and more into Anki flashcard decks.',
  h1: 'Convert anything to Anki',
  subhead:
    'Pick your source. Every converter turns your notes, files, or flashcards into a clean .apkg deck you study in Anki.',
};

export function emitConvertHubPage(buildDir: string): string {
  const meta = CONVERT_HUB_META;
  const indexPath = join(buildDir, 'index.html');
  const source = readFileSync(indexPath, 'utf8');
  const copy: LandingCopy = {
    pathname: meta.pathname,
    title: meta.title,
    description: meta.description,
    h1: meta.h1,
    subhead: meta.subhead,
    faqs: [],
  };
  const slug = meta.pathname.replace(/^\//, '');
  const outDir = join(buildDir, slug);
  const outPath = join(outDir, 'index.html');
  mkdirSync(dirname(outPath), { recursive: true });
  const html = rewriteRoot(rewriteHead(source, copy), copy);
  writeFileSync(outPath, html, 'utf8');
  return outPath;
}

export function emitLandingPages(buildDir: string): string[] {
  const indexPath = join(buildDir, 'index.html');
  const source = readFileSync(indexPath, 'utf8');
  const emitted: string[] = [];

  for (const copy of LANDING_COPIES) {
    const slug = copy.pathname.replace(/^\//, '');
    const outDir = join(buildDir, slug);
    const outPath = join(outDir, 'index.html');
    mkdirSync(dirname(outPath), { recursive: true });
    let html = rewriteRoot(rewriteHead(source, copy), copy);
    const faqJsonLd = buildLandingFaqJsonLd(copy.faqs);
    if (faqJsonLd != null) {
      html = html.replace(
        /<\/head>/,
        `  <script type="application/ld+json">${faqJsonLd}</script>\n</head>`
      );
    }
    writeFileSync(outPath, html, 'utf8');
    emitted.push(outPath);
  }
  return emitted;
}

export interface MetaOnlyPageMeta {
  pathname: string;
  title: string;
  description: string;
}

const META_ONLY_PAGES: MetaOnlyPageMeta[] = [
  {
    pathname: '/upload',
    title: 'Upload notes and get an Anki deck — 2anki',
    description:
      'Drop a Notion export, PDF, Markdown, CSV, HTML, or .apkg file. Get an Anki deck back. Free for the first 100 cards a month, no add-on required.',
  },
  {
    pathname: '/pricing',
    title: 'Pricing — Free, Day Pass, Unlimited, Lifetime | 2anki',
    description:
      'Compare 2anki plans. Free converts 100 cards a month. Unlimited at $7.99/mo or $64/yr. Day and Week Passes from $4. Lifetime with Auto Sync included.',
  },
  {
    pathname: '/about',
    title: 'About 2anki — open-source Notion to Anki converter',
    description:
      'Why 2anki exists, who builds it, and how the project stays free and open source. Independent, no venture funding, supported by lifetime and subscription users.',
  },
  {
    pathname: '/app',
    title: 'Anki flashcards on iPhone — 2anki app',
    description:
      'Convert your notes and files into Anki decks on iPhone, iPad, and Mac. Markdown, PDF, Notion, CSV, OPML, Kindle — parsed on your device. On the App Store for iPhone, iPad, and Mac.',
  },
  {
    pathname: '/security',
    title: 'Report a security vulnerability — 2anki',
    description:
      'How to report a security issue in 2anki: what to include, what is in scope, and how fast we respond. Covers 2anki.net, the API, and the open-source repository.',
  },
  {
    pathname: '/contact',
    title: 'Contact 2anki — support and feedback',
    description:
      'Reach the people who build 2anki. Report a conversion problem, ask a billing question, or send feedback — messages go straight to the maintainer.',
  },
  {
    pathname: '/documentation/start-here/connect-notion',
    title: 'Connect Notion in 5 minutes — 2anki docs',
    description:
      'From signing in to your first deck downloaded: connect your Notion account once, pick a page, and 2anki builds the Anki deck. No exports, no zip files.',
  },
  {
    pathname: '/documentation/cards/notion-to-anki-japanese',
    title: 'Notion to Anki for Japanese — 2anki docs',
    description:
      'Structure mined sentences and vocab in Notion, keep audio and screenshots, choose a note type, and open the deck in Anki. For sentence miners and JLPT studiers.',
  },
];

export function emitMetaOnlyPages(buildDir: string): string[] {
  const indexPath = join(buildDir, 'index.html');
  const source = readFileSync(indexPath, 'utf8');
  const emitted: string[] = [];

  for (const meta of META_ONLY_PAGES) {
    const canonical = canonicalUrl(meta.pathname);
    const slug = meta.pathname.replace(/^\//, '');
    const outDir = join(buildDir, slug);
    const outPath = join(outDir, 'index.html');
    mkdirSync(dirname(outPath), { recursive: true });

    const titleTag = `<title>${escapeHtml(meta.title)}</title>`;
    const descriptionTag = `<meta name="description" content="${escapeHtml(meta.description)}">`;
    const ogTags = [
      `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
      `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
      `<meta property="og:url" content="${canonical}">`,
      '<meta property="og:type" content="website">',
      `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
      `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    ].join('\n  ');

    let html = source.replace(/<title>[\s\S]*?<\/title>/, titleTag);
    html = html.replace(/<meta\s+name="description"[^>]*>/, descriptionTag);
    html = html.replace(
      /<link\s+rel="canonical"[^>]*>/,
      `<link rel="canonical" href="${canonical}">`
    );
    html = stripExistingMeta(html);
    html = html.replace(/<\/head>/, `  ${ogTags}\n</head>`);

    writeFileSync(outPath, html, 'utf8');
    emitted.push(outPath);
  }
  return emitted;
}

export function emitAnswersPages(buildDir: string): string[] {
  const indexPath = join(buildDir, 'index.html');
  const source = readFileSync(indexPath, 'utf8');
  const emitted: string[] = [];

  for (const config of ANSWERS_PAGES.values()) {
    const pathname = `/answers/${config.slug}`;
    const copy: LandingCopy = {
      pathname,
      title: config.title,
      description: config.description,
      h1: config.h1,
      subhead: config.intro,
      faqs: [],
    };
    const slug = pathname.replace(/^\//, '');
    const outDir = join(buildDir, slug);
    const outPath = join(outDir, 'index.html');
    mkdirSync(dirname(outPath), { recursive: true });
    let html = rewriteRoot(rewriteHead(source, copy), copy);
    const jsonLdScripts = [buildArticleJsonLd(config), buildFaqJsonLd(config)]
      .filter((jsonLd) => jsonLd != null)
      .map((jsonLd) => `<script type="application/ld+json">${jsonLd}</script>`)
      .join('\n  ');
    html = html.replace(/<\/head>/, `  ${jsonLdScripts}\n</head>`);
    writeFileSync(outPath, html, 'utf8');
    emitted.push(outPath);
  }
  return emitted;
}

if (process.argv[1] && process.argv[1].endsWith('prerenderLandingPages.ts')) {
  const buildDir = join(process.cwd(), 'build');
  const files = emitLandingPages(buildDir);
  for (const file of files) {
    process.stdout.write(`prerendered ${file}\n`);
  }
  const marketplacePage = emitNotionMarketplacePage(buildDir);
  process.stdout.write(`prerendered ${marketplacePage}\n`);
  const convertHubPage = emitConvertHubPage(buildDir);
  process.stdout.write(`prerendered ${convertHubPage}\n`);
  const answerFiles = emitAnswersPages(buildDir);
  for (const file of answerFiles) {
    process.stdout.write(`prerendered ${file}\n`);
  }
  const metaOnlyFiles = emitMetaOnlyPages(buildDir);
  for (const file of metaOnlyFiles) {
    process.stdout.write(`prerendered ${file}\n`);
  }
}
