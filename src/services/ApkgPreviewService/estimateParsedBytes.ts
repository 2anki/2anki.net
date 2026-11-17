import type { ParsedApkg } from './ApkgPreviewService';
import type { NoteType } from './types';

// Approximate V8 sizes on 64-bit Node without pointer compression. They only
// need to be close: the estimate feeds a cache budget, not an allocator.
const STRING_HEADER_BYTES = 16;
const OBJECT_BYTES = 64;
const HEAP_NUMBER_BYTES = 16;
const ARRAY_HEADER_BYTES = 32;
const POINTER_BYTES = 8;
const MAP_ENTRY_BYTES = 32;
const BUFFER_OBJECT_BYTES = 96;

const OUTSIDE_LATIN1 = /[Ā-￿]/;

export function estimateStringBytes(value: string): number {
  const bytesPerChar = OUTSIDE_LATIN1.test(value) ? 2 : 1;
  return STRING_HEADER_BYTES + value.length * bytesPerChar;
}

function estimateArrayBytes(length: number): number {
  return ARRAY_HEADER_BYTES + length * POINTER_BYTES;
}

function estimateNoteTypeBytes(noteType: NoteType): number {
  let bytes = OBJECT_BYTES + HEAP_NUMBER_BYTES;
  bytes +=
    estimateStringBytes(noteType.name) + estimateStringBytes(noteType.css);
  bytes += estimateArrayBytes(noteType.fields.length);
  for (const field of noteType.fields) {
    bytes += OBJECT_BYTES + estimateStringBytes(field.name);
  }
  bytes += estimateArrayBytes(noteType.templates.length);
  for (const template of noteType.templates) {
    bytes +=
      OBJECT_BYTES +
      estimateStringBytes(template.name) +
      estimateStringBytes(template.qfmt) +
      estimateStringBytes(template.afmt);
  }
  return bytes;
}

function estimateCollectionBytes(parsed: ParsedApkg): number {
  const { collection } = parsed;
  let bytes = 0;
  for (const note of collection.notes.values()) {
    bytes += MAP_ENTRY_BYTES + OBJECT_BYTES + 2 * HEAP_NUMBER_BYTES;
    bytes += estimateStringBytes(note.tags);
    if (note.guid != null) bytes += estimateStringBytes(note.guid);
    bytes += estimateArrayBytes(note.fields.length);
    for (const field of note.fields) {
      bytes += estimateStringBytes(field);
    }
  }
  bytes += estimateArrayBytes(collection.cards.length);
  bytes += collection.cards.length * (OBJECT_BYTES + 3 * HEAP_NUMBER_BYTES);
  for (const noteType of collection.noteTypes.values()) {
    bytes += MAP_ENTRY_BYTES + estimateNoteTypeBytes(noteType);
  }
  for (const deck of collection.decks.values()) {
    bytes += MAP_ENTRY_BYTES + OBJECT_BYTES + estimateStringBytes(deck.name);
  }
  return bytes;
}

function estimateMediaBytes(parsed: ParsedApkg): number {
  let bytes = 0;
  for (const [name, entry] of parsed.mediaEntries) {
    bytes += MAP_ENTRY_BYTES + estimateStringBytes(name);
    bytes += BUFFER_OBJECT_BYTES + entry.byteLength;
  }
  for (const [originalName, archiveName] of parsed.mediaMap) {
    bytes +=
      MAP_ENTRY_BYTES +
      estimateStringBytes(originalName) +
      estimateStringBytes(archiveName);
  }
  return bytes;
}

// What one parsed deck keeps alive while it sits in the preview cache: the
// media buffers and the collection's strings and objects.
export function estimateParsedBytes(parsed: ParsedApkg): number {
  return estimateCollectionBytes(parsed) + estimateMediaBytes(parsed);
}
