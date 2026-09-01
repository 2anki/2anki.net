import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import notionCopy from '../src/pages/LandingPage/copy/notion';
import notionZuAnkiCopy from '../src/pages/LandingPage/copy/notion-zu-anki';
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
import {
  DEFAULT_LANDING_FORMATS,
  DEFAULT_LANDING_STEPS,
} from '../src/pages/LandingPage/landingDefaults';

const LANDING_COPIES: LandingCopy[] = [
  notionCopy,
  notionZuAnkiCopy,
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

const SECTION_STYLE = 'max-width:720px;margin:0 auto;padding:2rem 1.5rem 0;';
const SECTION_LABEL_STYLE =
  'font-size:var(--text-sm);font-weight:var(--font-semibold);text-transform:uppercase;letter-spacing:0.15em;color:var(--color-text-tertiary);margin:0 0 0.75rem;';
const BODY_TEXT_STYLE =
  'color:var(--color-text-secondary);line-height:var(--leading-relaxed);margin:0 0 1rem;';

function sectionFragment(heading: string, inner: string): string {
  return [
    `<section style="${SECTION_STYLE}">`,
    `<h2 style="${SECTION_LABEL_STYLE}">${escapeHtml(heading)}</h2>`,
    inner,
    '</section>',
  ].join('');
}

function faqFragment(faqs: ReadonlyArray<{ q: string; a: string }>): string {
  if (faqs.length === 0) return '';
  const items = faqs
    .map(
      (faq) =>
        `<details><summary style="font-weight:var(--font-semibold);cursor:pointer;">${escapeHtml(
          faq.q
        )}</summary><p style="${BODY_TEXT_STYLE}">${escapeHtml(faq.a)}</p></details>`
    )
    .join('');
  return sectionFragment('Common questions', items);
}

function buildBodyFragment(copy: LandingCopy): string {
  const steps = (copy.steps ?? DEFAULT_LANDING_STEPS)
    .map(
      (step, idx) =>
        `<div><p style="font-weight:var(--font-semibold);margin:0;">${idx + 1}. ${escapeHtml(
          step.title
        )}</p><p style="${BODY_TEXT_STYLE}">${escapeHtml(step.body)}</p></div>`
    )
    .join('');

  const formats = (copy.formats ?? DEFAULT_LANDING_FORMATS)
    .map((format) => `<li style="display:inline-block;margin:0 0.75rem 0.5rem 0;">${escapeHtml(format)}</li>`)
    .join('');

  const whatComesAcross =
    copy.whatComesAcross == null || copy.whatComesAcross.length === 0
      ? ''
      : sectionFragment(
          'What you actually get in Anki',
          copy.whatComesAcross
            .map(
              (item) =>
                `<div><p style="font-weight:var(--font-semibold);margin:0;">${escapeHtml(
                  item.title
                )}</p><p style="${BODY_TEXT_STYLE}">${escapeHtml(item.body)}</p></div>`
            )
            .join('')
        );

  const related =
    copy.relatedLinks == null || copy.relatedLinks.length === 0
      ? ''
      : sectionFragment(
          'Related',
          `<ul style="list-style:none;padding:0;margin:0;">${copy.relatedLinks
            .map(
              (link) =>
                `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`
            )
            .join('')}</ul>`
        );

  return [
    buildHeroFragment(copy),
    sectionFragment('How it works', steps),
    sectionFragment(
      'Supported formats',
      `<ul style="list-style:none;padding:0;margin:0;">${formats}</ul>`
    ),
    whatComesAcross,
    faqFragment(copy.faqs),
    related,
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

function localizedHeadTags(copy: LandingCopy): string {
  const tags: string[] = [];
  for (const alt of copy.alternates ?? []) {
    tags.push(
      `<link rel="alternate" hreflang="${escapeHtml(
        alt.hreflang
      )}" href="${escapeHtml(alt.href)}">`
    );
  }
  if (copy.htmlLang != null) {
    const ogLocale = `${copy.htmlLang}_${copy.htmlLang.toUpperCase()}`;
    tags.push(
      `<meta property="og:locale" content="${escapeHtml(ogLocale)}">`
    );
  }
  return tags.join('\n  ');
}

function rewriteHtmlLang(html: string, copy: LandingCopy): string {
  if (copy.htmlLang == null) {
    return html;
  }
  return html.replace(
    /<html lang="en">/,
    `<html lang="${escapeHtml(copy.htmlLang)}">`
  );
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
  if (copy.htmlLang != null) {
    next = next.replace(/\s*<meta\s+property="og:locale"[^>]*>/g, '');
  }
  const localized = localizedHeadTags(copy);
  const headInsert = localized === '' ? ogTags : `${ogTags}\n  ${localized}`;
  next = next.replace(/<\/head>/, `  ${headInsert}\n</head>`);
  next = rewriteHtmlLang(next, copy);
  return next;
}

function rewriteRoot(html: string, copy: LandingCopy): string {
  const body = buildBodyFragment(copy);
  return html.replace(/<div id="root"><\/div>/, `<div id="root">${body}</div>`);
}

const NOTION_MARKETPLACE_META = {
  pathname: '/notion-marketplace',
  title: 'Sync Notion to Anki automatically | 2anki',
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
  h1: string;
  intro: string;
}

const META_ONLY_PAGES: MetaOnlyPageMeta[] = [
  {
    pathname: '/upload',
    title: 'Upload notes and get an Anki deck — 2anki',
    description:
      'Drop a Notion export, PDF, Markdown, CSV, HTML, or .apkg file. Get an Anki deck back. Free for the first 100 cards a month, no add-on required.',
    h1: 'Upload notes, get an Anki deck',
    intro:
      'Drop a Notion export, PDF, Markdown, CSV, HTML, or .apkg file and 2anki builds a deck you open in Anki. Free for the first 100 cards a month — no add-on, no software to install.',
  },
  {
    pathname: '/pricing',
    title: 'Pricing — Free, Day Pass, Unlimited, Lifetime | 2anki',
    description:
      'Compare 2anki plans. Free converts 100 cards a month. Unlimited at $7.99/mo or $64/yr. Day and Week Passes from $4. Lifetime with Auto Sync included.',
    h1: 'Pricing',
    intro:
      'Free converts 100 cards a month. Unlimited is $7.99/mo or $64/yr. A Day Pass is $4, a Week Pass $9 — one-time payments, no subscription. Lifetime is $345 once, with Auto Sync included. Cancel any subscription in one click.',
  },
  {
    pathname: '/about',
    title: 'About 2anki — open-source Notion to Anki converter',
    description:
      'Why 2anki exists, who builds it, and how the project stays free and open source. Independent, no venture funding, supported by lifetime and subscription users.',
    h1: 'About 2anki',
    intro:
      '2anki turns what you study into Anki flashcards. Independent since 2020, open source, no venture funding — built by Alexander Alemayhu and contributors, funded by the people who use it.',
  },
  {
    pathname: '/app',
    title: 'Anki flashcards on iPhone — 2anki app',
    description:
      'Convert your notes and files into Anki decks on iPhone, iPad, and Mac. Markdown, PDF, Notion, CSV, OPML, Kindle — parsed on your device. On the App Store for iPhone, iPad, and Mac.',
    h1: '2anki for iPhone, iPad, and Mac',
    intro:
      'Convert notes and files into Anki decks on your device. Markdown, PDF, Notion, CSV, OPML, and Kindle highlights — parsed locally, free on the App Store.',
  },
  {
    pathname: '/security',
    title: 'Report a security vulnerability — 2anki',
    description:
      'How to report a security issue in 2anki: what to include, what is in scope, and how fast we respond. Covers 2anki.net, the API, and the open-source repository.',
    h1: 'Report a security vulnerability',
    intro:
      'Found a security issue in 2anki.net, the API, or the open-source repository? Email support@2anki.net with a clear write-up, steps to reproduce, and what you could access.',
  },
  {
    pathname: '/contact',
    title: 'Contact 2anki — support and feedback',
    description:
      'Reach the people who build 2anki. Report a conversion problem, ask a billing question, or send feedback — messages go straight to the maintainer.',
    h1: 'Contact 2anki',
    intro:
      'Report a conversion problem, ask a billing question, or send feedback. Messages go straight to the maintainer.',
  },
  {
    pathname: '/documentation/start-here/connect-notion',
    title: 'Connect Notion in 5 minutes — 2anki docs',
    description:
      'From signing in to your first deck downloaded: connect your Notion account once, pick a page, and 2anki builds the Anki deck. No exports, no zip files.',
    h1: 'Connect Notion in 5 minutes',
    intro:
      'The fastest way to get Notion notes into Anki: connect your Notion account once, pick a page, and 2anki builds the deck. No exports, no zip files.',
  },
  {
    pathname: '/documentation/cards/notion-to-anki-japanese',
    title: 'Notion to Anki for Japanese — 2anki docs',
    description:
      'Structure mined sentences and vocab in Notion, keep audio and screenshots, choose a note type, and open the deck in Anki. For sentence miners and JLPT studiers.',
    h1: 'Notion → Anki for Japanese',
    intro:
      'For sentence miners, JLPT studiers, and kanji writers: structure mined sentences and vocab in Notion, keep audio and screenshots, choose a note type, and open the deck in Anki.',
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
    html = html.replace(
      /<div id="root"><\/div>/,
      [
        '<div id="root"><section style="max-width:720px;margin:0 auto;padding:3rem 1.5rem;">',
        `<h1 style="font-family:var(--font-display);font-size:clamp(2rem, 5vw, 2.75rem);line-height:1.15;margin:0 0 1rem;">${escapeHtml(meta.h1)}</h1>`,
        `<p style="${BODY_TEXT_STYLE}">${escapeHtml(meta.intro)}</p>`,
        '</section></div>',
      ].join('')
    );

    writeFileSync(outPath, html, 'utf8');
    emitted.push(outPath);
  }
  return emitted;
}

function buildAnswersBodyFragment(config: {
  h1: string;
  intro: string;
  sections: ReadonlyArray<{ heading: string; body: string }>;
  faqs?: ReadonlyArray<{ q: string; a: string }>;
}): string {
  const sections = config.sections
    .map(
      (section) =>
        `<section style="${SECTION_STYLE}"><h2 style="font-weight:var(--font-semibold);margin:0 0 0.5rem;">${escapeHtml(
          section.heading
        )}</h2><p style="${BODY_TEXT_STYLE}">${escapeHtml(section.body)}</p></section>`
    )
    .join('');
  return [
    `<article style="max-width:720px;margin:0 auto;padding:3rem 1.5rem;">`,
    `<h1 style="font-family:var(--font-display);font-size:clamp(2rem, 5vw, 2.75rem);line-height:1.15;margin:0 0 1rem;">${escapeHtml(
      config.h1
    )}</h1>`,
    `<p style="${BODY_TEXT_STYLE}">${escapeHtml(config.intro)}</p>`,
    sections,
    faqFragment(config.faqs ?? []),
    '</article>',
  ].join('');
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
    let html = rewriteHead(source, copy);
    html = html.replace(
      /<div id="root"><\/div>/,
      `<div id="root">${buildAnswersBodyFragment(config)}</div>`
    );
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
