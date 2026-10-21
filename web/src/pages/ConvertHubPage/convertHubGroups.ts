import { CONVERT_LANDING_PAGES } from '../ConvertLandingPage/convertLandingConfig';

export interface ConvertHubEntry {
  slug: string;
  href: string;
  anchor: string;
  blurb: string;
}

export interface ConvertHubGroup {
  heading: string;
  entries: ConvertHubEntry[];
}

interface RawEntry {
  slug: string;
  anchor: string;
  blurb: string;
}

const NOTE_APPS: RawEntry[] = [
  {
    slug: 'notion-to-anki',
    anchor: 'Convert Notion pages to Anki',
    blurb:
      'Connect Notion once, paste a page link, get a .apkg deck. Toggles become cards.',
  },
  {
    slug: 'notion-tables-to-anki',
    anchor: 'Convert Notion tables to Anki',
    blurb:
      'Turn a Notion table into cards — one row per card, column 1 front, column 2 back.',
  },
  {
    slug: 'notion-toggles-to-anki',
    anchor: 'Convert Notion toggles to Anki',
    blurb:
      'Each toggle becomes a card — heading on the front, content on the back.',
  },
  {
    slug: 'notion-export-to-anki',
    anchor: 'Convert a Notion export to Anki',
    blurb:
      'Already exported a .zip or HTML? Upload it and get a deck — no connection.',
  },
  {
    slug: 'markdown-to-anki',
    anchor: 'Convert Markdown and Obsidian notes to Anki',
    blurb:
      'Drop a .md file — bullets, Q/A pairs, and code blocks all become cards.',
  },
  {
    slug: 'obsidian-to-anki',
    anchor: 'Convert Obsidian notes to Anki',
    blurb:
      'Drop a vault note or export — Markdown headings and links become cards, no plugin.',
  },
  {
    slug: 'onenote-to-anki',
    anchor: 'Convert OneNote pages to Anki',
    blurb:
      'Export a OneNote page to PDF or Word and turn its headings into cards.',
  },
  {
    slug: 'evernote-to-anki',
    anchor: 'Convert Evernote notes to Anki',
    blurb:
      'Export Evernote notes as HTML — your headings and lists become cards.',
  },
  {
    slug: 'google-docs-to-anki',
    anchor: 'Convert Google Docs to Anki',
    blurb: 'Download a Google Doc as Word or Markdown and turn it into a deck.',
  },
];

const FLASHCARD_APPS: RawEntry[] = [
  {
    slug: 'brainscape-to-anki',
    anchor: 'Move Brainscape flashcards to Anki',
    blurb:
      'Export your Brainscape deck as CSV and convert it to a clean .apkg.',
  },
  {
    slug: 'lingvist-to-anki',
    anchor: 'Move Lingvist flashcards to Anki',
    blurb:
      'Export your Lingvist vocabulary as CSV — words and translations become cards.',
  },
  {
    slug: 'studystack-to-anki',
    anchor: 'Move StudyStack flashcards to Anki',
    blurb:
      'Export your stack and convert terms and definitions into Anki cards.',
  },
  {
    slug: 'zorbi-to-anki',
    anchor: 'Move Zorbi flashcards to Anki',
    blurb:
      'Export your Zorbi deck as CSV — questions and answers become Anki cards.',
  },
];

const FILE_FORMATS: RawEntry[] = [
  {
    slug: 'pdf-to-anki',
    anchor: 'Convert a PDF to Anki',
    blurb:
      'Drop a PDF of lecture slides or a textbook chapter and get a .apkg deck.',
  },
  {
    slug: 'csv-to-anki',
    anchor: 'Convert a CSV or Excel sheet to Anki',
    blurb:
      'Drop a .csv or .xlsx — one row per card, ready to import into Anki.',
  },
  {
    slug: 'html-to-anki',
    anchor: 'Convert an HTML file to Anki',
    blurb:
      'Drop a saved web page — headings, bullets, and tables become cards.',
  },
  {
    slug: 'epub-to-anki',
    anchor: 'Convert EPUB highlights to Anki',
    blurb:
      'Drop a DRM-free .epub — each passage you highlighted becomes a card.',
  },
  {
    slug: 'kindle-to-anki',
    anchor: 'Convert Kindle highlights to Anki',
    blurb:
      'Upload My Clippings.txt — every Kindle highlight and note becomes a card.',
  },
  {
    slug: 'apkg-to-csv',
    anchor: 'Export an Anki deck to CSV',
    blurb:
      'Upload an .apkg and download a spreadsheet of every card to edit or share.',
  },
  {
    slug: 'excel-to-anki',
    anchor: 'Convert an Excel .xlsx to Anki',
    blurb:
      'Drop an .xlsx — one row per card, column 1 front and column 2 back.',
  },
  {
    slug: 'word-to-anki',
    anchor: 'Convert a Word document to Anki',
    blurb:
      'Drop a .docx — headings become card fronts and the body becomes the back.',
  },
  {
    slug: 'google-sheets-to-anki',
    anchor: 'Convert Google Sheets to Anki',
    blurb: 'Download a sheet as .csv or .xlsx — each row becomes a card.',
  },
  {
    slug: 'txt-to-anki',
    anchor: 'Convert a text file to Anki',
    blurb: 'Drop a plain .txt list — question and answer lines become cards.',
  },
  {
    slug: 'photo-to-anki',
    anchor: 'Convert a photo of notes to Anki',
    blurb:
      'Upload a photo of your notes — AI writes question-and-answer cards you can edit.',
  },
  {
    slug: 'screenshot-to-anki',
    anchor: 'Convert a screenshot to Anki',
    blurb: 'Upload a screenshot of a slide or page — AI turns it into a card.',
  },
  {
    slug: 'google-slides-to-anki',
    anchor: 'Convert Google Slides to Anki',
    blurb: 'Export slides to PDF — each slide becomes a card front.',
  },
];

const LANGUAGE_TOOLS: RawEntry[] = [
  {
    slug: 'pleco-to-anki',
    anchor: 'Move Pleco flashcards to Anki',
    blurb:
      'Export your Pleco userdict as .txt — hanzi, pinyin, and definitions become cards.',
  },
  {
    slug: 'language-reactor-to-anki',
    anchor: 'Move Language Reactor saves to Anki',
    blurb:
      'Drop the Language Reactor export zip — phrases, images, and audio come across.',
  },
];

const RAW_GROUPS: ReadonlyArray<{ heading: string; entries: RawEntry[] }> = [
  { heading: 'Note apps', entries: NOTE_APPS },
  { heading: 'Flashcard apps', entries: FLASHCARD_APPS },
  { heading: 'Files', entries: FILE_FORMATS },
  { heading: 'Language tools', entries: LANGUAGE_TOOLS },
];

function resolveHref(slug: string): string {
  const copy = CONVERT_LANDING_PAGES.get(slug);
  if (copy == null) {
    throw new Error(`Convert hub references unknown converter slug: ${slug}`);
  }
  return copy.pathname;
}

export const CONVERT_HUB_GROUPS: ReadonlyArray<ConvertHubGroup> =
  RAW_GROUPS.map((group) => ({
    heading: group.heading,
    entries: group.entries.map((entry) => ({
      slug: entry.slug,
      href: resolveHref(entry.slug),
      anchor: entry.anchor,
      blurb: entry.blurb,
    })),
  }));

const coveredSlugs = new Set(
  CONVERT_HUB_GROUPS.flatMap((group) =>
    group.entries.map((entry) => entry.slug)
  )
);

for (const slug of Array.from(CONVERT_LANDING_PAGES.keys())) {
  if (!coveredSlugs.has(slug)) {
    throw new Error(
      `Convert hub is missing a group entry for converter: ${slug}`
    );
  }
}
