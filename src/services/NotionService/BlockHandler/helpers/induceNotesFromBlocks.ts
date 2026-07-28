import { isFullBlock } from '@notionhq/client';
import {
  GetBlockResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import Note from '../../../../lib/parser/Note';
import CardOption from '../../../../lib/parser/Settings';
import TagRegistry from '../../../../lib/parser/TagRegistry';
import { InducedRule } from '../../../../lib/parser/induction/candidateRules';
import {
  answerMarkerLength,
  questionMarkerLength,
  startsWithAnswerMarker,
  startsWithQuestionMarker,
  TERM_DEFINITION_SEPARATOR,
} from '../../../../lib/parser/induction/questionMarkers';
import renderTextChildren from '../../helpers/renderTextChildren';

// Which flat block types open a new card for each structural candidate. The
// back is the rendered content of the blocks that follow the front until the
// next front-type block, so a heading and its paragraphs, or a bullet and its
// explanation, become one card. Columns are absent here on purpose: a
// column_list's columns are child blocks the walk never fetched, and fetching
// them would break the zero-extra-Notion-request contract — the upload path
// rescues two-column layouts from the DOM instead, where they cost nothing.
const FRONT_TYPES: Partial<Record<InducedRule, ReadonlySet<string>>> = {
  // heading_1 is included even though the issue table names only heading_2/3:
  // the deleted plain-text guessCardsFromBlocks matched heading_1/2/3, so a
  // heading_1-structured page (a title-per-section export) that rescued on main
  // would otherwise regress to an honest-empty failure.
  heading: new Set(['heading_1', 'heading_2', 'heading_3']),
  bullets: new Set(['bulleted_list_item']),
  numbered: new Set(['numbered_list_item']),
  quote: new Set(['quote']),
};

// The candidates the Notion rescue can offer from flat in-memory blocks alone.
// 'guess' is the text-pattern candidate (Q:/A:, term::definition); it locates
// boundaries on plain text but renders card content from the rich blocks.
export const NOTION_CANDIDATE_RULES: readonly InducedRule[] = [
  'heading',
  'bullets',
  'numbered',
  'quote',
  'guess',
];

function blockRichText(block: GetBlockResponse): RichTextItemResponse[] | null {
  if (!isFullBlock(block)) {
    return null;
  }
  const content = (block as Record<string, unknown>)[block.type];
  if (content == null || typeof content !== 'object') {
    return null;
  }
  const richText = (content as { rich_text?: unknown }).rich_text;
  if (!Array.isArray(richText)) {
    return null;
  }
  return richText as RichTextItemResponse[];
}

function blockPlainText(block: GetBlockResponse): string {
  const richText = blockRichText(block);
  if (richText == null) {
    return '';
  }
  return richText.map((item) => item.plain_text ?? '').join('');
}

function cloneItemWithText(
  item: RichTextItemResponse,
  text: string
): RichTextItemResponse {
  const clone = { ...item, plain_text: text } as RichTextItemResponse;
  if (item.type === 'text' && item.text != null) {
    (clone as { text: { content: string; link: unknown } }).text = {
      ...item.text,
      content: text,
    };
  }
  return clone;
}

// Returns the rich-text items covering plain-text character range [from, to),
// slicing the single item that straddles a boundary while keeping its
// annotations, so a formatted span survives an intra-block split.
function sliceRichText(
  items: RichTextItemResponse[],
  from: number,
  to: number
): RichTextItemResponse[] {
  const result: RichTextItemResponse[] = [];
  let position = 0;
  for (const item of items) {
    const text = item.plain_text ?? '';
    const start = position;
    const end = position + text.length;
    position = end;
    const overlapFrom = Math.max(from, start);
    const overlapTo = Math.min(to, end);
    if (overlapFrom >= overlapTo) {
      continue;
    }
    if (overlapFrom === start && overlapTo === end) {
      result.push(item);
    } else {
      result.push(
        cloneItemWithText(
          item,
          text.slice(overlapFrom - start, overlapTo - start)
        )
      );
    }
  }
  return result;
}

function renderItems(
  items: RichTextItemResponse[],
  settings: CardOption,
  tagRegistry: TagRegistry
): string {
  if (items.length === 0) {
    return '';
  }
  return renderTextChildren(items, settings, tagRegistry).trim();
}

// Renders a single block's own rich text through the same pipeline toggle cards
// use (renderTextChildren -> HandleBlockAnnotations), so bold, highlight and
// colour annotations and inline equations survive into the rescued card. Never
// recurses into child blocks, so no Notion request is issued.
function renderBlockInline(
  block: GetBlockResponse,
  settings: CardOption,
  tagRegistry: TagRegistry
): string {
  const richText = blockRichText(block);
  if (richText == null) {
    return '';
  }
  return renderItems(richText, settings, tagRegistry);
}

function isFrontType(
  block: GetBlockResponse,
  frontTypes: ReadonlySet<string>
): boolean {
  return isFullBlock(block) && frontTypes.has(block.type);
}

function groupByFrontType(
  blocks: GetBlockResponse[],
  frontTypes: ReadonlySet<string>,
  settings: CardOption,
  tagRegistry: TagRegistry
): Note[] {
  const notes: Note[] = [];
  let front = '';
  let backParts: string[] = [];

  const flush = () => {
    const back = backParts.filter((part) => part.length > 0).join('<br />');
    if (front.length > 0 && back.trim().length > 0) {
      notes.push(new Note(front, back));
    }
    front = '';
    backParts = [];
  };

  for (const block of blocks) {
    if (isFrontType(block, frontTypes)) {
      flush();
      front = renderBlockInline(block, settings, tagRegistry);
      continue;
    }
    if (front.length > 0) {
      const rendered = renderBlockInline(block, settings, tagRegistry);
      if (rendered.length > 0) {
        backParts.push(rendered);
      }
    }
  }
  flush();
  return notes;
}

function pushIfComplete(notes: Note[], front: string, back: string): void {
  if (front.length > 0 && back.length > 0) {
    notes.push(new Note(front, back));
  }
}

// Index of the next block that carries any plain text, or -1. A divider or a
// child-page block between the question and its answer has no rich text, so the
// pairing scans past it instead of giving up (which is what the deleted helper
// did when it flattened the whole page first).
function nextTextBearingIndex(
  blocks: GetBlockResponse[],
  from: number
): number {
  for (let i = from; i < blocks.length; i += 1) {
    if (blockPlainText(blocks[i]).length > 0) {
      return i;
    }
  }
  return -1;
}

// Returns the index of the answer block it consumed, or -1 when the block at
// `index` does not open a question/answer pair.
function tryQuestionAnswerPair(
  blocks: GetBlockResponse[],
  index: number,
  settings: CardOption,
  tagRegistry: TagRegistry,
  notes: Note[]
): number {
  const questionText = blockPlainText(blocks[index]);
  if (!startsWithQuestionMarker(questionText)) {
    return -1;
  }
  const answerIndex = nextTextBearingIndex(blocks, index + 1);
  if (answerIndex === -1) {
    return -1;
  }
  const answerText = blockPlainText(blocks[answerIndex]);
  if (!startsWithAnswerMarker(answerText)) {
    return -1;
  }
  const questionItems = blockRichText(blocks[index]) ?? [];
  const answerItems = blockRichText(blocks[answerIndex]) ?? [];
  const front = renderItems(
    sliceRichText(
      questionItems,
      questionMarkerLength(questionText),
      questionText.length
    ),
    settings,
    tagRegistry
  );
  const back = renderItems(
    sliceRichText(
      answerItems,
      answerMarkerLength(answerText),
      answerText.length
    ),
    settings,
    tagRegistry
  );
  pushIfComplete(notes, front, back);
  return answerIndex;
}

function tryTermDefinition(
  block: GetBlockResponse,
  settings: CardOption,
  tagRegistry: TagRegistry,
  notes: Note[]
): void {
  const text = blockPlainText(block);
  const separatorIndex = text.indexOf(TERM_DEFINITION_SEPARATOR);
  if (separatorIndex <= 0) {
    return;
  }
  const items = blockRichText(block) ?? [];
  const front = renderItems(
    sliceRichText(items, 0, separatorIndex),
    settings,
    tagRegistry
  );
  const back = renderItems(
    sliceRichText(
      items,
      separatorIndex + TERM_DEFINITION_SEPARATOR.length,
      text.length
    ),
    settings,
    tagRegistry
  );
  pushIfComplete(notes, front, back);
}

// The text-pattern candidate. Markers (Q:/A: and their 10-locale variants,
// term::definition) locate the boundary on plain text; the card is rendered
// from the rich blocks, so annotations survive.
function induceTextPatternNotes(
  blocks: GetBlockResponse[],
  settings: CardOption,
  tagRegistry: TagRegistry
): Note[] {
  const notes: Note[] = [];
  let index = 0;
  while (index < blocks.length) {
    const answerIndex = tryQuestionAnswerPair(
      blocks,
      index,
      settings,
      tagRegistry,
      notes
    );
    if (answerIndex !== -1) {
      index = answerIndex + 1;
      continue;
    }
    tryTermDefinition(blocks[index], settings, tagRegistry, notes);
    index += 1;
  }
  return notes;
}

export function induceNotesFromBlocks(
  blocks: GetBlockResponse[],
  rule: InducedRule,
  settings: CardOption,
  tagRegistry: TagRegistry
): Note[] {
  const notes =
    rule === 'guess'
      ? induceTextPatternNotes(blocks, settings, tagRegistry)
      : structuralNotes(blocks, rule, settings, tagRegistry);
  notes.forEach((note, order) => {
    note.number = order;
  });
  return notes;
}

function structuralNotes(
  blocks: GetBlockResponse[],
  rule: InducedRule,
  settings: CardOption,
  tagRegistry: TagRegistry
): Note[] {
  const frontTypes = FRONT_TYPES[rule];
  if (frontTypes == null) {
    return [];
  }
  return groupByFrontType(blocks, frontTypes, settings, tagRegistry);
}

export function blocksPlainTextLength(blocks: GetBlockResponse[]): number {
  let length = 0;
  for (const block of blocks) {
    length += blockPlainText(block).length;
  }
  return length;
}

export default induceNotesFromBlocks;
