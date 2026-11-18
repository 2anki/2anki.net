import { NoteType, NoteTypeTemplate } from './types';

export interface EditableField {
  fieldIndex: number;
  fieldName: string;
}

export interface EditableSides {
  front: EditableField | null;
  back: EditableField | null;
}

interface FieldReference {
  field: EditableField;
  filters: string[];
  conditional: boolean;
}

// Applied to Anki template strings (qfmt/afmt) from the deck's own note-type
// config, not from HTTP input. Negated classes bound the captures.
const TEMPLATE_TAG = /\{\{([#^/])?([^{}]+?)\}\}/g; // NOSONAR

const SCRIPT_OR_STYLE_BLOCK =
  /<(script|style)\b[^>]*(?:>[\s\S]*?(?:<\/\1\s*>|$)|$)/gi; // NOSONAR

const SPECIAL_NAMES = new Set([
  'FrontSide',
  'Tags',
  'Type',
  'Deck',
  'Subdeck',
  'Card',
]);

const NO_EDITABLE_FIELDS: EditableSides = { front: null, back: null };

function isTextToSpeech(filter: string): boolean {
  return filter === 'tts' || filter.startsWith('tts ');
}

function isTypeInAnswer(reference: FieldReference): boolean {
  return reference.filters.includes('type');
}

function fieldNameOf(rawTag: string): string {
  return (rawTag.split(':').pop() ?? '').trim();
}

function fieldNamesInsideCode(template: string): Set<string> {
  const names = new Set<string>();
  for (const block of template.match(SCRIPT_OR_STYLE_BLOCK) ?? []) {
    for (const tag of block.matchAll(TEMPLATE_TAG)) {
      names.add(fieldNameOf(tag[2]));
    }
  }
  return names;
}

function fieldReferences(
  template: string,
  noteType: NoteType,
  usedInCode: Set<string>
): FieldReference[] {
  const ordByName = new Map(
    noteType.fields.map((field) => [field.name, field.ord])
  );
  const openSections: string[] = [];
  const references: FieldReference[] = [];
  const shownMarkup = template.replace(SCRIPT_OR_STYLE_BLOCK, '');
  TEMPLATE_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_TAG.exec(shownMarkup)) != null) {
    const [, sigil, raw] = match;
    if (sigil === '#' || sigil === '^') {
      openSections.push(raw.trim());
    } else if (sigil === '/') {
      const open = openSections.lastIndexOf(raw.trim());
      if (open !== -1) openSections.splice(open, 1);
    } else {
      const parts = raw.split(':');
      const name = (parts.pop() ?? '').trim();
      const filters = parts.map((part) => part.trim()).filter(Boolean);
      const fieldIndex = ordByName.get(name);
      if (
        fieldIndex != null &&
        !SPECIAL_NAMES.has(name) &&
        !usedInCode.has(name) &&
        !filters.some(isTextToSpeech)
      ) {
        references.push({
          field: { fieldIndex, fieldName: name },
          filters,
          conditional: openSections.length > 0,
        });
      }
    }
  }
  return references;
}

function firstShown(
  references: FieldReference[],
  excluded: Set<number> = new Set()
): EditableField | null {
  const candidates = references.filter(
    (reference) => !excluded.has(reference.field.fieldIndex)
  );
  const pick =
    candidates.find((reference) => !reference.conditional) ?? candidates[0];
  return pick?.field ?? null;
}

function templateForCard(
  noteType: NoteType,
  cardOrd: number
): NoteTypeTemplate | undefined {
  const templateOrd = noteType.type === 1 ? 0 : cardOrd;
  return (
    noteType.templates.find((t) => t.ord === templateOrd) ??
    noteType.templates[0]
  );
}

export function resolveEditableFields(
  noteType: NoteType,
  cardOrd: number
): EditableSides {
  const template = templateForCard(noteType, cardOrd);
  if (template == null) return NO_EDITABLE_FIELDS;
  if (template.qfmt.includes('image-occlusion-canvas')) {
    return NO_EDITABLE_FIELDS;
  }
  const usedInCode = new Set([
    ...fieldNamesInsideCode(template.qfmt),
    ...fieldNamesInsideCode(template.afmt),
  ]);
  const shownOnQuestion = fieldReferences(
    template.qfmt,
    noteType,
    usedInCode
  ).filter((reference) => !isTypeInAnswer(reference));
  if (noteType.type === 1) {
    const clozeReferences = shownOnQuestion.filter((reference) =>
      reference.filters.includes('cloze')
    );
    return {
      front: firstShown(clozeReferences) ?? firstShown(shownOnQuestion),
      back: null,
    };
  }
  const front = firstShown(shownOnQuestion);
  const editedOnQuestion = new Set(front == null ? [] : [front.fieldIndex]);
  return {
    front,
    back:
      firstShown(
        fieldReferences(template.afmt, noteType, usedInCode),
        editedOnQuestion
      ) ?? firstShown(shownOnQuestion, editedOnQuestion),
  };
}
