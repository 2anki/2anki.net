import path from 'path';
import fs from 'fs';

import { DeckParser } from '../../lib/parser/DeckParser';
import CardOption from '../../lib/parser/Settings';
import Workspace from '../../lib/parser/WorkSpace';

export interface ExportDriftShape {
  deckCount: number;
  cardCount: number;
  nonEmptyFrontCount: number;
  nonEmptyBackCount: number;
  mediaCount: number;
}

export interface ExportDriftFixture {
  driftClass: string;
  parserName: string;
  htmlPath: string;
  mediaDir?: string;
  mediaPrefix?: string;
  baseline: ExportDriftShape;
}

export type ExportDriftField = keyof ExportDriftShape;

export interface ExportDriftFailure {
  driftClass: string;
  htmlPath: string;
  expected: ExportDriftShape;
  actual: ExportDriftShape;
  divergedFields: ExportDriftField[];
}

export type ExportDriftResult =
  | { status: 'pass'; failures: [] }
  | { status: 'fail'; failures: ExportDriftFailure[] };

const FIXTURES_DIR = path.join(__dirname, '../../lib/parser/__fixtures__');

export const EXPORT_DRIFT_FIXTURES: ExportDriftFixture[] = [
  {
    driftClass: 'display:contents wrapper (2024 export)',
    parserName: 'index.html',
    htmlPath: 'notion-html-2024/index.html',
    mediaDir: 'notion-html-2024/notion-html-2024',
    mediaPrefix: 'notion-html-2024',
    baseline: {
      deckCount: 1,
      cardCount: 3,
      nonEmptyFrontCount: 3,
      nonEmptyBackCount: 2,
      mediaCount: 1,
    },
  },
  {
    driftClass: 'details.toggle (2026 export)',
    parserName: 'notion-details-toggle-2026.html',
    htmlPath: 'notion-details-toggle-2026.html',
    baseline: {
      deckCount: 1,
      cardCount: 1,
      nonEmptyFrontCount: 1,
      nonEmptyBackCount: 1,
      mediaCount: 0,
    },
  },
  {
    driftClass: 'nested details.toggle (2026 export)',
    parserName: 'notion-nested-toggle-2026-capitals.html',
    htmlPath: 'notion-nested-toggle-2026-capitals.html',
    baseline: {
      deckCount: 1,
      cardCount: 1,
      nonEmptyFrontCount: 1,
      nonEmptyBackCount: 1,
      mediaCount: 0,
    },
  },
  {
    driftClass: 'figure.image subfolder path (Apr-2026 export)',
    parserName: 'notion-figure-image-2026.html',
    htmlPath: 'notion-figure-image-2026.html',
    mediaDir: 'notion-figure-image-2026/media',
    mediaPrefix: 'Sample Diagram Set',
    baseline: {
      deckCount: 1,
      cardCount: 1,
      nonEmptyFrontCount: 1,
      nonEmptyBackCount: 1,
      mediaCount: 1,
    },
  },
  {
    driftClass: 'figure.equation data-notion-equation (2026 KaTeX export)',
    parserName: 'notion-katex-equation-2026.html',
    htmlPath: 'notion-katex-equation-2026.html',
    baseline: {
      deckCount: 1,
      cardCount: 1,
      nonEmptyFrontCount: 1,
      nonEmptyBackCount: 1,
      mediaCount: 0,
    },
  },
];

const isNonEmpty = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

function readBundledMedia(
  mediaDir: string,
  mediaPrefix: string
): { name: string; contents: Buffer }[] {
  const absoluteDir = path.join(FIXTURES_DIR, mediaDir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }
  const files: { name: string; contents: Buffer }[] = [];
  for (const entry of fs.readdirSync(absoluteDir)) {
    const fullPath = path.join(absoluteDir, entry);
    if (fs.statSync(fullPath).isFile()) {
      files.push({
        name: `${mediaPrefix}/${entry}`,
        contents: fs.readFileSync(fullPath),
      });
    }
  }
  return files;
}

export async function measureExportDriftFixture(
  fixture: ExportDriftFixture
): Promise<ExportDriftShape> {
  const html = fs
    .readFileSync(path.join(FIXTURES_DIR, fixture.htmlPath))
    .toString();

  const media =
    fixture.mediaDir != null
      ? readBundledMedia(fixture.mediaDir, fixture.mediaPrefix ?? '')
      : [];

  const settings = new CardOption({
    'max-one-toggle-per-card': 'true',
    cherry: 'false',
    cloze: 'true',
    'mcq-enabled': 'true',
  });
  const parser = new DeckParser({
    name: fixture.parserName,
    settings,
    files: [{ name: fixture.parserName, contents: html }, ...media],
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });
  parser.customExporter.save = () => Promise.resolve(Buffer.alloc(0));
  await parser.build(new Workspace(true, 'fs'));

  const decks = parser.payload;
  const cards = decks.flatMap((deck) => deck.cards);

  return {
    deckCount: decks.length,
    cardCount: cards.length,
    nonEmptyFrontCount: cards.filter((card) => isNonEmpty(card.name)).length,
    nonEmptyBackCount: cards.filter((card) => isNonEmpty(card.back)).length,
    mediaCount: cards.reduce((sum, card) => sum + (card.media?.length ?? 0), 0),
  };
}

function divergedFields(
  expected: ExportDriftShape,
  actual: ExportDriftShape
): ExportDriftField[] {
  const fields: ExportDriftField[] = [
    'deckCount',
    'cardCount',
    'nonEmptyFrontCount',
    'nonEmptyBackCount',
    'mediaCount',
  ];
  return fields.filter((field) => expected[field] !== actual[field]);
}

export async function runExportDriftCanary(
  fixtures: ExportDriftFixture[] = EXPORT_DRIFT_FIXTURES
): Promise<ExportDriftResult> {
  const failures: ExportDriftFailure[] = [];

  for (const fixture of fixtures) {
    const actual = await measureExportDriftFixture(fixture);
    const diverged = divergedFields(fixture.baseline, actual);
    if (diverged.length > 0) {
      failures.push({
        driftClass: fixture.driftClass,
        htmlPath: fixture.htmlPath,
        expected: fixture.baseline,
        actual,
        divergedFields: diverged,
      });
    }
  }

  if (failures.length === 0) {
    return { status: 'pass', failures: [] };
  }
  return { status: 'fail', failures };
}
