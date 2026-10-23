import Deck from './Deck';
import { getTitleFromMarkdown } from './getTitleFromMarkdown';
import get16DigitRandomId from '../../shared/helpers/get16DigitRandomId';
import Note from './Note';
import { markdownToHTML } from '../markdown';
import * as cheerio from 'cheerio';

import CardOption from './Settings';
import { embedFile } from './exporters/embedFile';
import { isImageFileEmbedable } from '../storage/checks';
import CustomExporter from './exporters/CustomExporter';
import Workspace from './WorkSpace';

import { File } from '../zip/zip';
import { detectMarkdownMCQ } from './findNotionToggleLists';
import { stripLeadingDeckNumbering } from './helpers/stripLeadingDeckNumbering';
import { matchesMarkdownHeuristic } from './guessMarkdownCards';
import { buildDeckStyle } from './buildDeckStyle';

function commonIndent(text: string): number {
  const nonEmptyLines = text.split('\n').filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return 0;
  return Math.min(
    ...nonEmptyLines.map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0)
  );
}

function dedent(text: string): string {
  const minIndent = commonIndent(text);
  if (minIndent === 0) return text;
  return text
    .split('\n')
    .map((l) => l.slice(minIndent))
    .join('\n');
}

interface BuildNoteResult {
  note: Note;
  mcqShapedWithoutMarker: boolean;
}

function buildNoteFromBack(
  front: string,
  rawBack: string,
  exporter: CustomExporter,
  files: File[],
  workspace: Workspace,
  mcqEnabled: boolean,
  embedImages: boolean
): BuildNoteResult {
  const convertedBack = markdownToHTML(dedent(rawBack), true);
  const dom = cheerio.load(convertedBack, null, false);
  const media: string[] = [];

  if (embedImages) {
    dom('img').each((_i, elem) => {
      const src = dom(elem).attr('src');
      if (src && isImageFileEmbedable(src)) {
        const newName = embedFile({
          exporter,
          files,
          filePath: decodeURIComponent(src),
          workspace,
        });
        if (newName) {
          dom(elem).attr('src', newName);
          media.push(newName);
        }
      }
    });
  }

  const note = new Note(front, dom.html() || '');
  note.media = media;

  if (!mcqEnabled) {
    return { note, mcqShapedWithoutMarker: false };
  }

  const mcq = detectMarkdownMCQ(convertedBack);
  if (mcq.isMcqShape && mcq.correctIndex >= 0) {
    note.mcq = true;
    note.options = mcq.options;
    note.correctIndices = [mcq.correctIndex];
    note.back = '';
    return { note, mcqShapedWithoutMarker: false };
  }
  return { note, mcqShapedWithoutMarker: mcq.isMcqShape };
}

const DASH_ITEM_REGEX = /^-/;

const NEW_ITEM_REGEX = /^(?:[*+]|\d{1,9}[.)])(?:[ \t]|$)/;

const NEW_ITEM_SEPARATOR_REGEX = /^[ \t]{0,3}([*+])(?:[ \t]*\1){2,}[ \t]*$/;

const SUBHEADING_REGEX = /^#{2,}[ \t]/m;

// A `*`, `+`, or ordered marker starts a card only in a bullet-shaped document
// and never when the line is a decorative rule (* * *, + + +). `-` is handled
// separately — it is always a card boundary, exactly as the original parser.
function startsNewMarkerItem(dedentedLine: string): boolean {
  return (
    NEW_ITEM_REGEX.test(dedentedLine) &&
    !NEW_ITEM_SEPARATOR_REGEX.test(dedentedLine)
  );
}

// The new markers (*, +, ordered) are enabled only for a document that is
// unambiguously one of their lists: no `##`+ heading (that is heading-body
// shape, whose list lines belong on a card back), no column-0 `-` front (that
// is a dash-style document, where a `*`/`+`/ordered line is sub-content, not a
// separate card), and no match for any guessMarkdownCards pattern (Q:/A:,
// <details>, `::`, separators) — those documents converted well before and must
// keep falling through to guessMarkdownCards. Every other document then behaves
// exactly as before: `-` still starts cards, and the rest falls through.
function documentHasSubheading(body: string): boolean {
  return SUBHEADING_REGEX.test(body);
}

function hasColumnZeroDashFront(rawLines: string[]): boolean {
  return rawLines.some((line) => DASH_ITEM_REGEX.test(line));
}

// A YAML front-matter fence is a run of dashes. Without stripping it, the
// metadata between the fences would be read as card content, so DeckParser
// never falls through to guessMarkdownCards, which strips front matter
// correctly. Every Obsidian and Logseq export hits this.
const YAML_FRONT_MATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;

function stripYamlFrontMatter(contents: string): string {
  return contents.replace(YAML_FRONT_MATTER_REGEX, '');
}

interface HandleNestedBulletPointsInMarkdownInput {
  name: string;
  contents: string | undefined;
  deckName: string | undefined;
  decks: Deck[];
  settings: CardOption;
  exporter: CustomExporter;
  workspace: Workspace;
  files: File[];
}

export const handleNestedBulletPointsInMarkdown = (
  input: HandleNestedBulletPointsInMarkdownInput
) => {
  const {
    name,
    contents,
    deckName,
    decks,
    settings,
    exporter,
    workspace,
    files,
  } = input;
  const body = stripYamlFrontMatter(contents ?? '');
  const derivedName = getTitleFromMarkdown(body) ?? name;
  const resolvedDeckName =
    deckName ??
    (settings.removeDeckNameNumbering
      ? stripLeadingDeckNumbering(derivedName)
      : derivedName);
  const deck = new Deck(
    resolvedDeckName,
    [],
    '',
    buildDeckStyle(settings),
    get16DigitRandomId(),
    settings
  );

  decks.push(deck);

  const withoutAside = body.replace(/^<\/?aside[^>]*>\s*$/gim, '');
  const indent = commonIndent(withoutAside);
  const rawLines = withoutAside.split('\n');
  const newMarkersAllowed =
    !documentHasSubheading(dedent(withoutAside)) &&
    !hasColumnZeroDashFront(rawLines) &&
    !matchesMarkdownHeuristic(body);
  let isCreating = false;
  let currentFront = '';
  let currentBack = '';

  const flushCurrent = () => {
    const result = buildNoteFromBack(
      currentFront,
      currentBack,
      exporter,
      files,
      workspace,
      settings.mcqEnabled,
      settings.embedImages
    );
    deck.cards.push(result.note);
    if (result.note.mcq) {
      deck.mcqCount += 1;
    } else if (result.mcqShapedWithoutMarker) {
      deck.mcqSkippedCount += 1;
    }
  };

  for (const rawLine of rawLines) {
    if (rawLine.trim().length === 0) {
      continue;
    }

    const dedentedLine = indent === 0 ? rawLine : rawLine.slice(indent);
    const dashFront = DASH_ITEM_REGEX.test(rawLine);
    const newFront =
      !dashFront && newMarkersAllowed && startsNewMarkerItem(dedentedLine);
    const startsCard = dashFront || newFront;

    if (startsCard && isCreating) {
      flushCurrent();
      isCreating = false;
      currentFront = '';
      currentBack = '';
    }

    if (startsCard && !isCreating) {
      isCreating = true;
      currentFront = markdownToHTML(dashFront ? rawLine : dedentedLine, true);
      currentBack = '';
    } else if (isCreating) {
      currentBack += rawLine + '\n';
    }
  }

  if (currentBack !== '' || currentFront !== '') {
    flushCurrent();
  }

  return decks;
};
