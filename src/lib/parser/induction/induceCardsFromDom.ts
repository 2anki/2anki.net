import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';
import Note from '../Note';
import { InducedRule } from './candidateRules';
import {
  answerMarkerLength,
  findTermDefinitionSeparator,
  questionMarkerLength,
  startsWithAnswerMarker,
  startsWithQuestionMarker,
  TERM_DEFINITION_SEPARATOR,
} from './questionMarkers';

// docx, PDF, Markdown and Notion exports are all converted to HTML before
// reaching the parser, so one DOM inducer covers every upload format. It reads
// the same candidate vocabulary as the Notion path, expressed as DOM selectors,
// and card fronts/backs carry the matched nodes' INNER HTML, so bold, <mark>,
// and colour spans survive. Boundaries are located on textContent only; content
// is always the rich HTML.
export const UPLOAD_CANDIDATE_RULES: readonly InducedRule[] = [
  'columns',
  'heading',
  'bullets',
  'numbered',
  'quote',
  'guess',
];

const HEADING_TAGS = new Set(['h2', 'h3']);
const BOLD_TAGS = new Set(['strong', 'b']);

function tagName(element: Element): string {
  return element.type === 'tag' ? element.name.toLowerCase() : '';
}

// A Word "Heading" style becomes an <h1> that preprocessDocxHTML turns into a
// toggle, but a section marked with a fully bold paragraph reaches the parser as
// a bare <p><strong>…</strong></p>. Treat that paragraph as a section heading so
// the prose beneath it becomes the card back. A paragraph with any text outside
// the bold run (e.g. "<strong>Note:</strong> some text") is ordinary content and
// is left alone.
function isBoldOnlyParagraph(dom: CheerioAPI, element: Element): boolean {
  if (tagName(element) !== 'p') {
    return false;
  }
  const node = dom(element);
  const text = node.text().trim();
  if (text.length === 0) {
    return false;
  }
  const elementChildren = node.children().toArray();
  if (elementChildren.length !== 1) {
    return false;
  }
  const only = elementChildren[0] as Element;
  if (!BOLD_TAGS.has(tagName(only))) {
    return false;
  }
  return dom(only).text().trim() === text;
}

function isHeadingFront(dom: CheerioAPI, element: Element): boolean {
  return (
    HEADING_TAGS.has(tagName(element)) || isBoldOnlyParagraph(dom, element)
  );
}

function topLevelBlocks(dom: CheerioAPI): Element[] {
  let container = dom('.page-body').first();
  if (container.length === 0) {
    container = dom('body').first();
  }
  const children =
    container.length > 0 ? container.children() : dom.root().children();
  return children
    .toArray()
    .filter((node): node is Element => (node as Element).type === 'tag');
}

function innerHtml(dom: CheerioAPI, element: Element): string {
  return (dom(element).html() ?? '').trim();
}

function textOf(dom: CheerioAPI, element: Element): string {
  return dom(element).text().trim();
}

function pushCard(notes: Note[], front: string, back: string): void {
  if (front.length > 0 && back.trim().length > 0) {
    notes.push(new Note(front, back));
  }
}

function groupByTag(
  dom: CheerioAPI,
  blocks: Element[],
  isFront: (element: Element) => boolean
): Note[] {
  const notes: Note[] = [];
  let front = '';
  let backParts: string[] = [];

  const flush = () => {
    pushCard(notes, front, backParts.join(''));
    front = '';
    backParts = [];
  };

  for (const block of blocks) {
    if (isFront(block)) {
      flush();
      front = innerHtml(dom, block);
      continue;
    }
    if (front.length > 0) {
      const rendered = innerHtml(dom, block);
      if (rendered.length > 0) {
        backParts.push(rendered);
      }
    }
  }
  flush();
  return notes;
}

function induceHeadingCards(dom: CheerioAPI): Note[] {
  return groupByTag(dom, topLevelBlocks(dom), (element) =>
    isHeadingFront(dom, element)
  );
}

function induceQuoteCards(dom: CheerioAPI): Note[] {
  return groupByTag(
    dom,
    topLevelBlocks(dom),
    (element) => tagName(element) === 'blockquote'
  );
}

// A nested outline: the list item's own text is the prompt, the list nested
// inside it is the answer. A flat list item has no nested list, so it produces
// no back and is dropped.
function induceNestedListCards(dom: CheerioAPI, listTag: string): Note[] {
  const notes: Note[] = [];
  dom(`${listTag} > li`).each((_index, li) => {
    const item = dom(li);
    const nested = item.children('ul,ol');
    const back = (nested.html() ?? '').trim();
    const clone = item.clone();
    clone.children('ul,ol').remove();
    const front = (clone.html() ?? '').trim();
    pushCard(notes, front, back);
  });
  return notes;
}

// A header row (every cell a <th>, or any row inside <thead>) labels the
// columns rather than pairing a term with its definition, so it is not a card.
function isHeaderRow(dom: CheerioAPI, row: Element, cells: Element[]): boolean {
  if (dom(row).parents('thead').length > 0) {
    return true;
  }
  return cells.every((cell) => tagName(cell) === 'th');
}

// Each row of a top-level table becomes a card: first cell the prompt, the
// remaining cells joined as the answer (a three-column glossary keeps its third
// column instead of dropping it). A single-cell row yields an empty back and is
// skipped. Tables nested inside another table are left to their enclosing row's
// cell HTML, so a row is never turned into a card twice.
function induceColumnCards(dom: CheerioAPI): Note[] {
  const notes: Note[] = [];
  dom('table').each((_tableIndex, table) => {
    if (dom(table).parents('table').length > 0) {
      return;
    }
    dom(table)
      .find('tr')
      .each((_rowIndex, row) => {
        if (dom(row).closest('table').get(0) !== table) {
          return;
        }
        const cells = dom(row)
          .children('td,th')
          .toArray()
          .filter((cell): cell is Element => (cell as Element).type === 'tag');
        if (cells.length < 2 || isHeaderRow(dom, row, cells)) {
          return;
        }
        const front = innerHtml(dom, cells[0]);
        const back = cells
          .slice(1)
          .map((cell) => innerHtml(dom, cell))
          .filter((cell) => cell.length > 0)
          .join('<br>');
        pushCard(notes, front, back);
      });
  });
  return notes;
}

const EMPTY_STRIPPABLE_INLINE =
  'strong,em,b,i,span,mark,code,u,del,ins,small,sub,sup,a';
const VOID_CONTENT = 'img,br,hr,embed,audio,video,iframe,svg,picture';

// Removes inline formatting wrappers left empty after a slice, so a front cut at
// a boundary reads `Osmosis` rather than `Osmosis<strong></strong>`. Void
// content (an image, a line break) inside the wrapper keeps it.
function removeEmptyInlineWrappers(
  dom: CheerioAPI,
  clone: Cheerio<Element>
): void {
  clone.find(EMPTY_STRIPPABLE_INLINE).each((_index, element) => {
    const node = dom(element);
    if (node.text().trim() === '' && node.find(VOID_CONTENT).length === 0) {
      node.remove();
    }
  });
}

// Returns the element's inner HTML restricted to the visible-text range
// [from, to). Slices the text nodes that straddle a boundary while keeping every
// tag, so a marker or separator that sits inside a <strong> is stripped without
// mangling the markup — the reason boundaries are found on plain text but cards
// are rendered from the rich source.
function sliceElementHtml(
  dom: CheerioAPI,
  element: Element,
  from: number,
  to: number
): string {
  const clone = dom(element).clone();
  const root = clone.get(0);
  if (root == null) {
    return '';
  }
  let offset = 0;
  const walk = (node: AnyNode) => {
    if (node.type === 'text') {
      const textNode = node as Text;
      const data = textNode.data ?? '';
      const start = offset;
      const end = offset + data.length;
      offset = end;
      const overlapFrom = Math.max(from, start);
      const overlapTo = Math.min(to, end);
      textNode.data =
        overlapFrom < overlapTo
          ? data.slice(overlapFrom - start, overlapTo - start)
          : '';
      return;
    }
    for (const child of (node as Element).children ?? []) {
      walk(child);
    }
  };
  for (const child of root.children ?? []) {
    walk(child);
  }
  removeEmptyInlineWrappers(dom, clone);
  return (clone.html() ?? '').trim();
}

function nextTextBearingIndex(
  dom: CheerioAPI,
  blocks: Element[],
  from: number
): number {
  for (let i = from; i < blocks.length; i += 1) {
    if (textOf(dom, blocks[i]).length > 0) {
      return i;
    }
  }
  return -1;
}

function tryDomQuestionAnswer(
  dom: CheerioAPI,
  blocks: Element[],
  index: number,
  notes: Note[]
): number {
  const questionText = dom(blocks[index]).text();
  if (!startsWithQuestionMarker(questionText)) {
    return -1;
  }
  const answerIndex = nextTextBearingIndex(dom, blocks, index + 1);
  if (answerIndex === -1) {
    return -1;
  }
  const answerText = dom(blocks[answerIndex]).text();
  if (!startsWithAnswerMarker(answerText)) {
    return -1;
  }
  const front = sliceElementHtml(
    dom,
    blocks[index],
    questionMarkerLength(questionText),
    questionText.length
  );
  const back = sliceElementHtml(
    dom,
    blocks[answerIndex],
    answerMarkerLength(answerText),
    answerText.length
  );
  pushCard(notes, front, back);
  return answerIndex;
}

function tryDomTermDefinition(
  dom: CheerioAPI,
  element: Element,
  notes: Note[]
): void {
  const text = dom(element).text();
  const separatorIndex = findTermDefinitionSeparator(text);
  if (separatorIndex <= 0) {
    return;
  }
  const front = sliceElementHtml(dom, element, 0, separatorIndex);
  const back = sliceElementHtml(
    dom,
    element,
    separatorIndex + TERM_DEFINITION_SEPARATOR.length,
    text.length
  );
  pushCard(notes, front, back);
}

function induceTextPatternCards(dom: CheerioAPI): Note[] {
  const blocks = topLevelBlocks(dom);
  const notes: Note[] = [];
  let index = 0;
  while (index < blocks.length) {
    const answerIndex = tryDomQuestionAnswer(dom, blocks, index, notes);
    if (answerIndex !== -1) {
      index = answerIndex + 1;
      continue;
    }
    tryDomTermDefinition(dom, blocks[index], notes);
    index += 1;
  }
  return notes;
}

export function induceCardsFromDom(dom: CheerioAPI, rule: InducedRule): Note[] {
  const notes = runRule(dom, rule);
  notes.forEach((note, order) => {
    note.number = order;
  });
  return notes;
}

function runRule(dom: CheerioAPI, rule: InducedRule): Note[] {
  switch (rule) {
    case 'heading':
      return induceHeadingCards(dom);
    case 'quote':
      return induceQuoteCards(dom);
    case 'bullets':
      return induceNestedListCards(dom, 'ul');
    case 'numbered':
      return induceNestedListCards(dom, 'ol');
    case 'columns':
      return induceColumnCards(dom);
    case 'guess':
      return induceTextPatternCards(dom);
    default:
      return [];
  }
}

export function domPlainTextLength(dom: CheerioAPI): number {
  const pageBody: Cheerio<Element> = dom('.page-body');
  const scope = pageBody.length > 0 ? pageBody : dom('body');
  const text = scope.length > 0 ? scope.text() : dom.root().text();
  return text.trim().length;
}

export default induceCardsFromDom;
