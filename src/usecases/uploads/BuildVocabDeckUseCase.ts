import path from 'path';

import Deck from '../../lib/parser/Deck';
import Note from '../../lib/parser/Note';
import CustomExporter from '../../lib/parser/exporters/CustomExporter';
import CardOption from '../../lib/parser/Settings/CardOption';
import Workspace from '../../lib/parser/WorkSpace';
import getDeckFilename from '../../lib/anki/getDeckFilename';

import {
  ClippingEntry,
  groupByBook,
  parseMyClippings,
} from '../../lib/vocab/MyClippingsParser';
import { EpubHighlight, walkEpub } from '../../lib/vocab/EpubWalker';
import { buildDeckStyle } from '../../lib/parser/buildDeckStyle';

export interface VocabDeckResult {
  readonly name: string;
  readonly apkg: Buffer;
  readonly cardCount: number;
  readonly source: 'kindle-clippings' | 'epub';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBack(book: string, author: string): string {
  const safeBook = book ? `<strong>${escapeHtml(book)}</strong>` : '';
  const safeAuthor = author ? `<em>${escapeHtml(author)}</em>` : '';
  if (safeBook && safeAuthor) return `${safeBook}<br>${safeAuthor}`;
  return safeBook || safeAuthor || '';
}

function buildNote(
  front: string,
  book: string,
  author: string,
  sourceTag: string
): Note {
  const note = new Note(escapeHtml(front), renderBack(book, author));
  note.tags = [sourceTag];
  return note;
}

interface BookCards {
  readonly book: string;
  readonly notes: readonly Note[];
}

function noteFromKindleEntry(entry: ClippingEntry, sourceTag: string): Note {
  return buildNote(entry.highlight, entry.book, entry.author, sourceTag);
}

function noteFromEpubHighlight(entry: EpubHighlight, sourceTag: string): Note {
  return buildNote(entry.highlight, entry.book, entry.author, sourceTag);
}

function buildDecks(
  parentName: string,
  perBook: readonly BookCards[],
  settings: CardOption
): Deck[] {
  if (perBook.length === 0) return [];
  if (perBook.length === 1) {
    const only = perBook[0];
    const name = only.book || parentName;
    return [
      new Deck(
        name,
        Array.from(only.notes),
        undefined,
        buildDeckStyle(settings),
        Date.now(),
        settings
      ),
    ];
  }
  let id = Date.now();
  return perBook.map((bookCards) => {
    id += 1;
    const subDeckName = `${parentName}::${bookCards.book || 'Untitled'}`;
    return new Deck(
      subDeckName,
      Array.from(bookCards.notes),
      undefined,
      buildDeckStyle(settings),
      id,
      settings
    );
  });
}

function exportDecks(
  decks: Deck[],
  parentName: string,
  workspace: Workspace
): Promise<Buffer> {
  const exporter = new CustomExporter(parentName, workspace.location);
  exporter.configure(decks);
  return exporter.save();
}

export interface BuildVocabDeckInput {
  readonly file: { readonly name: string; readonly contents: Buffer };
  readonly settings: CardOption;
  readonly workspace: Workspace;
}

export async function buildVocabDeckFromKindleClippings(
  input: BuildVocabDeckInput
): Promise<VocabDeckResult> {
  const sourceTag = 'source=kindle-clippings';
  const text = input.file.contents.toString('utf8');
  const { entries } = parseMyClippings(text);
  if (entries.length === 0) {
    throw new Error(
      'No highlights found in My Clippings.txt. The file may contain only ' +
        'bookmarks or clippings in an unsupported language.'
    );
  }

  const grouped = groupByBook(entries);
  const perBook: BookCards[] = [];
  for (const [book, bookEntries] of grouped) {
    perBook.push({
      book,
      notes: bookEntries.map((e) => noteFromKindleEntry(e, sourceTag)),
    });
  }

  const parentName = path.parse(input.file.name).name || 'Kindle Highlights';
  const decks = buildDecks(parentName, perBook, input.settings);
  const apkg = await exportDecks(decks, parentName, input.workspace);
  const cardCount = decks.reduce((sum, d) => sum + d.cards.length, 0);

  return {
    name: getDeckFilename(parentName),
    apkg,
    cardCount,
    source: 'kindle-clippings',
  };
}

export async function buildVocabDeckFromEpub(
  input: BuildVocabDeckInput
): Promise<VocabDeckResult> {
  const sourceTag = 'source=epub';
  const result = walkEpub(new Uint8Array(input.file.contents));
  if (result.highlights.length === 0) {
    throw new Error(
      'This EPUB contains no highlighted passages. Highlight passages in ' +
        'your e-reader first, then re-upload.'
    );
  }

  // EPUBs are single-book; OPF metadata gives the title.
  const book = result.highlights[0].book;
  const author = result.highlights[0].author;
  const notes = result.highlights.map((h) =>
    noteFromEpubHighlight({ ...h, book, author }, sourceTag)
  );

  const parentName =
    book || path.parse(input.file.name).name || 'EPUB Highlights';
  const decks = buildDecks(
    parentName,
    [{ book: parentName, notes }],
    input.settings
  );
  const apkg = await exportDecks(decks, parentName, input.workspace);

  return {
    name: getDeckFilename(parentName),
    apkg,
    cardCount: notes.length,
    source: 'epub',
  };
}
