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

function dedent(text: string): string {
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return text;
  const minIndent = Math.min(
    ...nonEmptyLines.map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0)
  );
  if (minIndent === 0) return text;
  return lines.map((l) => l.slice(minIndent)).join('\n');
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

const BULLET_POINT_REGEX = /^-/;

// A YAML front-matter fence is a run of dashes, so BULLET_POINT_REGEX reads it
// as a card boundary: the opening fence becomes a card whose front is an <hr />
// and whose back is the metadata, and the closing fence becomes a card holding
// the rest of the file. Two junk cards are enough to look like a successful
// parse, so DeckParser never falls through to guessMarkdownCards, which strips
// front matter correctly. Every Obsidian and Logseq export hits this.
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
    '',
    get16DigitRandomId(),
    settings
  );

  decks.push(deck);

  const lines = body.replace(/^<\/?aside[^>]*>\s*$/gim, '').split('\n');
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

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    if (BULLET_POINT_REGEX.exec(line) && isCreating) {
      flushCurrent();
      isCreating = false;
      currentFront = '';
      currentBack = '';
    }

    if (BULLET_POINT_REGEX.exec(line) && !isCreating) {
      isCreating = true;
      currentFront = markdownToHTML(line, true);
      currentBack = '';
    } else if (isCreating) {
      currentBack += line + '\n';
    }
  }

  if (currentBack !== '' || currentFront !== '') {
    flushCurrent();
  }

  return decks;
};
