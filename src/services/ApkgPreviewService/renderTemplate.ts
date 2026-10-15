import { NoteType } from './types';

export interface TemplateSpecials {
  FrontSide?: string;
  Tags?: string;
  Type?: string;
  Deck?: string;
  Subdeck?: string;
  Card?: string;
}

// Applied to Anki template strings (qfmt/afmt) loaded from the deck's
// own note-type config — not from HTTP input. Negated classes bound the
// captures, so there's no unbounded backtracking window.
const TAG_REGEX = /\{\{([#^/])?([^{}]+?)\}\}/g; // NOSONAR

const FURIGANA_REGEX = /([^\s[\]]+)\[([^[\]]+)\]/g;

function stripHtml(input: string): string {
  // Sole input: rendered field values already size-capped by Anki's
  // own limits; no unbounded wildcards here.
  return input
    .replaceAll(/<br\b[^>]*>/gi, ' ') // NOSONAR
    .replaceAll(/<[^>]+>/g, '')
    .trim();
}

function isEmptyField(value: string | undefined): boolean {
  if (value == null) return true;
  const stripped = stripHtml(value).replace(/\u200b/g, '');
  return stripped.length === 0;
}

function applyFilter(filter: string, value: string): string {
  // `{{tts en_US voices=…:Field}}` is a play button in Anki, not text.
  if (filter === 'tts' || filter.startsWith('tts ')) return '';
  switch (filter) {
    case 'text':
      return stripHtml(value);
    case 'hint':
      return `<span class="hint">${value}</span>`;
    case 'type':
      return `<span class="typed-answer">${stripHtml(value)}</span>`;
    case 'furigana':
      return value.replaceAll(FURIGANA_REGEX, '$1');
    case 'kanji':
      return value.replaceAll(FURIGANA_REGEX, '$1');
    case 'kana':
      return value.replaceAll(FURIGANA_REGEX, '$2');
    case 'cloze':
      return value;
    default:
      // Add-on filters such as `edit:` (Edit Field During Review) only add
      // behaviour in Anki's reviewer, so the field passes through unchanged.
      return value;
  }
}

// `{{edit:cloze:Text}}` stacks filters; Anki applies them right to left,
// starting with the one next to the field name. `{{clickable::Tags}}` leaves
// an empty segment, which is skipped.
function parseFieldReference(raw: string): { name: string; filters: string[] } {
  const parts = raw.split(':');
  const name = (parts.pop() ?? '').trim();
  const filters = parts.map((part) => part.trim()).filter((part) => part);
  return { name, filters };
}

function applyFilters(filters: string[], value: string): string {
  return filters.reduceRight((acc, filter) => applyFilter(filter, acc), value);
}

function resolveFieldValue(
  name: string,
  fieldMap: Map<string, string>,
  specials: TemplateSpecials
): string | undefined {
  if (name === 'FrontSide') return specials.FrontSide;
  if (name === 'Tags') return specials.Tags;
  if (name === 'Type') return specials.Type;
  if (name === 'Deck') return specials.Deck;
  if (name === 'Subdeck') return specials.Subdeck;
  if (name === 'Card') return specials.Card;
  return fieldMap.get(name);
}

function evaluateBlock(
  source: string,
  start: number,
  openTag: string,
  fieldMap: Map<string, string>,
  specials: TemplateSpecials,
  isNegated: boolean,
  fieldName: string
): { end: number; output: string } {
  const closeTag = `{{/${fieldName}}}`;
  const closeIdx = source.indexOf(closeTag, start);
  if (closeIdx === -1) {
    return { end: source.length, output: '' };
  }
  const body = source.slice(start, closeIdx);
  const value = resolveFieldValue(fieldName, fieldMap, specials) ?? '';
  const empty = isEmptyField(value);
  const shouldRender = isNegated ? empty : !empty;
  const output = shouldRender
    ? renderTemplateInternal(body, fieldMap, specials)
    : '';
  return { end: closeIdx + closeTag.length, output };
}

function renderTemplateInternal(
  template: string,
  fieldMap: Map<string, string>,
  specials: TemplateSpecials
): string {
  let out = '';
  let lastIndex = 0;
  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(template)) != null) {
    const [full, sigil, rawName] = match;
    const name = rawName.trim();
    out += template.slice(lastIndex, match.index);

    if (sigil === '#' || sigil === '^') {
      const block = evaluateBlock(
        template,
        match.index + full.length,
        full,
        fieldMap,
        specials,
        sigil === '^',
        name
      );
      out += block.output;
      lastIndex = block.end;
      TAG_REGEX.lastIndex = block.end;
      continue;
    }

    if (sigil === '/') {
      lastIndex = match.index + full.length;
      continue;
    }

    const reference = parseFieldReference(rawName);
    const value = resolveFieldValue(reference.name, fieldMap, specials) ?? '';
    out += applyFilters(reference.filters, value);
    lastIndex = match.index + full.length;
  }
  out += template.slice(lastIndex);
  return out;
}

export function renderTemplate(
  template: string,
  fieldMap: Map<string, string>,
  specials: TemplateSpecials = {}
): string {
  return renderTemplateInternal(template, fieldMap, specials);
}

export function buildFieldMap(
  fields: string[],
  noteType: NoteType
): Map<string, string> {
  const map = new Map<string, string>();
  for (const fieldDef of noteType.fields) {
    map.set(fieldDef.name, fields[fieldDef.ord] ?? '');
  }
  return map;
}
