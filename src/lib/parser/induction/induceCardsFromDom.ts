import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import Note from '../Note';
import { InducedRule } from './candidateRules';
import {
  answerMarkerLength,
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

function tagName(element: Element): string {
  return element.type === 'tag' ? element.name.toLowerCase() : '';
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
    HEADING_TAGS.has(tagName(element))
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

// Each two-cell table row becomes a card. A single-cell row yields an empty
// back, so it is skipped rather than shipped.
function induceColumnCards(dom: CheerioAPI): Note[] {
  const notes: Note[] = [];
  dom('table tr').each((_index, row) => {
    const cells = dom(row)
      .children('td,th')
      .toArray()
      .filter((cell): cell is Element => (cell as Element).type === 'tag');
    if (cells.length < 2) {
      return;
    }
    const front = innerHtml(dom, cells[0]);
    const back = innerHtml(dom, cells[1]);
    pushCard(notes, front, back);
  });
  return notes;
}

function stripLeadingMarker(html: string, markerLength: number): string {
  return html.slice(markerLength).trim();
}

function tryDomQuestionAnswer(
  dom: CheerioAPI,
  blocks: Element[],
  index: number,
  notes: Note[]
): boolean {
  const questionText = textOf(dom, blocks[index]);
  if (!startsWithQuestionMarker(questionText)) {
    return false;
  }
  const answer = blocks[index + 1];
  if (answer == null) {
    return false;
  }
  const answerText = textOf(dom, answer);
  if (!startsWithAnswerMarker(answerText)) {
    return false;
  }
  const front = stripLeadingMarker(
    innerHtml(dom, blocks[index]),
    questionMarkerLength(innerHtml(dom, blocks[index]))
  );
  const back = stripLeadingMarker(
    innerHtml(dom, answer),
    answerMarkerLength(innerHtml(dom, answer))
  );
  pushCard(notes, front, back);
  return true;
}

function tryDomTermDefinition(
  dom: CheerioAPI,
  element: Element,
  notes: Note[]
): void {
  const text = textOf(dom, element);
  if (!text.includes(TERM_DEFINITION_SEPARATOR)) {
    return;
  }
  const html = innerHtml(dom, element);
  const separatorIndex = html.indexOf(TERM_DEFINITION_SEPARATOR);
  if (separatorIndex <= 0) {
    return;
  }
  const front = html.slice(0, separatorIndex).trim();
  const back = html
    .slice(separatorIndex + TERM_DEFINITION_SEPARATOR.length)
    .trim();
  pushCard(notes, front, back);
}

function induceTextPatternCards(dom: CheerioAPI): Note[] {
  const blocks = topLevelBlocks(dom);
  const notes: Note[] = [];
  let index = 0;
  while (index < blocks.length) {
    if (tryDomQuestionAnswer(dom, blocks, index, notes)) {
      index += 2;
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
