import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

import { File } from '../../zip/zip';
import {
  isHTMLFile,
  isMarkdownFile,
  isPlainText,
  isCSVFile,
} from '../../storage/checks';
import Deck from '../Deck';
import Note from '../Note';
import CardOption from '../Settings';
import { PlainTextParser } from './PlainTextParser/PlainTextParser';
import { Flashcard, isClozeFlashcard } from './PlainTextParser/types';
import get16DigitRandomId from '../../../shared/helpers/get16DigitRandomId';
import {
  cellText,
  detectFieldColumns,
  rowsFromBuffer,
} from '../../../infrastracture/adapters/fileConversion/tabularRows';

function isStructuredFlashcard(card: Flashcard): boolean {
  if (isClozeFlashcard(card)) {
    return true;
  }
  return (
    'back' in card &&
    typeof card.back === 'string' &&
    card.back.trim().length > 0
  );
}

class FallbackParser {
  constructor(private readonly files: File[]) {}

  htmlToTextWithNewlines(html: string) {
    if (typeof html !== 'string' || !html.trim()) {
      console.warn(
        '[FallbackParser] htmlToTextWithNewlines called with invalid html:',
        html
      );
      return [];
    }
    const $ = cheerio.load(html);

    function processListItems(items: cheerio.Cheerio<AnyNode>) {
      let result = '';
      items.each((_, element) => {
        const itemText = $(element).text().trim();
        result += `• ${itemText}\n`;
      });
      return result;
    }

    const topLevelLists = $('ul, ol').filter(
      (_, element) => $(element).parents('ul, ol').length === 0
    );
    let items: string[] = [];
    topLevelLists.each((_, element) => {
      const listItems = $(element).children('li');
      const listText = processListItems(listItems);
      items.push(listText);
    });

    return items;
  }

  getTitleFromHTML(html: string) {
    const $ = cheerio.load(html);
    return $('title').text().trim();
  }

  getStyleTagFromString(html: string) {
    const $ = cheerio.load(html);
    const styleTag = $('style');

    if (styleTag.length === 0) {
      return ''; // No style tag found, return an empty string
    }

    return styleTag.text() ?? '';
  }

  /**
   * Extract bullet points from markdown content
   *
   * Matches lines starting with -, *, or + followed by one or more spaces or tabs,
   * and then any characters. This handles standard Markdown bullet point formats
   * as well as cloze deletion formats with backticks and equals separator.
   *
   * @param markdown markdown content
   * @returns array of bullet points or null if no bullet points found
   */
  getMarkdownBulletLists(markdown: string) {
    const bulletListRegex = /^[ \t]*[-*+][ \t]+.*/gm;
    return markdown.match(bulletListRegex);
  }

  /**
   * Return the correct title from markdown
   *
   * Notion can have two titles in Markdown files.
   * The first one is the title with a the id of the page.
   * The second one is the title of the page only.
   *
   * @param markdown user input markdown
   * @returns deck title
   */
  getTitleMarkdown(markdown: string) {
    const headingRegex = /^(#{1,6})\s+(.*)$/gm;
    const matches = [...markdown.matchAll(headingRegex)];
    if (matches.length >= 2) {
      return matches[1][2]; // return second match
    } else if (matches.length > 0) {
      return matches[0][2];
    }
    return 'Default';
  }

  mapCardsToNotes(cards: Flashcard[]): Note[] {
    return cards.filter(Boolean).map((card, index) => {
      const note = new Note(card.front, '');
      note.number = index;
      if (isClozeFlashcard(card)) {
        note.cloze = true;
      } else {
        note.back = card.back;

        if (!note.back || note.back.trim().length === 0) {
          const parts = note.name.split('\n');
          if (parts.length > 1) {
            note.name = parts[0];
            note.back = parts.slice(1).join('\n');
          }
        }
      }
      return note;
    });
  }

  isTabSeparated(contents: string): boolean {
    const lines = contents.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) return false;
    const tabLines = lines.filter((line) => line.includes('\t'));
    return tabLines.length > lines.length / 2;
  }

  parseTabSeparated(contents: string): Note[] {
    return contents
      .split('\n')
      .filter((line) => line.includes('\t'))
      .map((line, index) => {
        const [front, ...rest] = line.split('\t');
        const back = rest.join('\t');
        const note = new Note(front.trim(), '');
        note.back = back.trim();
        note.number = index;
        return note;
      })
      .filter((note) => note.name.length > 0 && note.back.length > 0);
  }

  isCommaSeparated(contents: string): boolean {
    const lines = contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 3) return false;
    if (
      lines.some(
        (line) =>
          line.includes('\t') || line.includes(' - ') || line.includes(' = ')
      )
    ) {
      return false;
    }
    const pairLines = lines.filter((line) => {
      const commaIndex = line.indexOf(',');
      return (
        line.split(',').length === 2 &&
        line.slice(0, commaIndex).trim().length > 0 &&
        line.slice(commaIndex + 1).trim().length > 0
      );
    });
    return pairLines.length >= lines.length * 0.9;
  }

  parseCommaSeparated(contents: string): Note[] {
    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(','))
      .map((line, index) => {
        const commaIndex = line.indexOf(',');
        const note = new Note(line.slice(0, commaIndex).trim(), '');
        note.back = line.slice(commaIndex + 1).trim();
        note.number = index;
        return note;
      })
      .filter((note) => note.name.length > 0 && note.back.length > 0);
  }

  private parseHTMLFile(
    contents: string,
    fileName: string
  ): { cards: Note[]; deckName: string } {
    const plainText = this.htmlToTextWithNewlines(contents).join('\n');
    const plainTextParser = new PlainTextParser();
    const found = plainTextParser.parse(plainText);
    return {
      cards: this.mapCardsToNotes(found),
      deckName: this.getTitleFromHTML(contents) ?? fileName,
    };
  }

  private parseTextFile(
    contents: string,
    fileName: string
  ): { cards: Note[]; deckName: string } | null {
    if (this.isTabSeparated(contents)) {
      return {
        cards: this.parseTabSeparated(contents),
        deckName: fileName.replace(/\.[^/.]+$/, ''),
      };
    }
    const items = this.getMarkdownBulletLists(contents);
    if (items) {
      const plainTextParser = new PlainTextParser();
      const found = plainTextParser.parse(items.join('\n'));
      return {
        cards: this.mapCardsToNotes(found),
        deckName: this.getTitleMarkdown(contents),
      };
    }
    if (this.isCommaSeparated(contents)) {
      return {
        cards: this.parseCommaSeparated(contents),
        deckName: fileName.replace(/\.[^/.]+$/, ''),
      };
    }
    return this.parseUnstructuredText(contents, fileName);
  }

  /**
   * Last resort for a .txt/.md file with no tabs and no bullet markers: parse
   * one card per line so `question - answer` / `question = answer` pairs still
   * become cards. Each line is fed to PlainTextParser as its own chunk (it
   * otherwise only splits on blank lines), and only structured cards — a cloze
   * or a non-empty back — are kept, so a file of plain prose stays an empty
   * deck instead of producing one junk card.
   */
  private parseUnstructuredText(
    contents: string,
    fileName: string
  ): { cards: Note[]; deckName: string } | null {
    const lines = contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return null;
    }
    const plainTextParser = new PlainTextParser();
    const structured = plainTextParser
      .parse(lines.join('\n\n'))
      .filter(isStructuredFlashcard);
    if (structured.length === 0) {
      return null;
    }
    const title = this.getTitleMarkdown(contents);
    return {
      cards: this.mapCardsToNotes(structured),
      deckName: title === 'Default' ? fileName.replace(/\.[^/.]+$/, '') : title,
    };
  }

  private parseCSVFile(
    contents: Uint8Array,
    fileName: string
  ): { cards: Note[]; deckName: string; clean: boolean } {
    const rows = rowsFromBuffer(Buffer.from(contents));
    const named = rows.length > 0 ? detectFieldColumns(rows[0]) : null;
    const frontIndex = named?.frontIndex ?? 0;
    const backIndex = named?.backIndex ?? 1;
    const dataRows = named ? rows.slice(1) : rows;

    const cards = dataRows
      .map((row, index) => {
        const note = new Note(
          cellText(row[frontIndex]),
          cellText(row[backIndex])
        );
        note.number = index;
        return note;
      })
      .filter((note) => note.name.trim().length > 0);

    return {
      cards,
      deckName: fileName?.replace(/\.[^/.]+$/, '') ?? 'Default',
      clean: false,
    };
  }

  run(settings: CardOption) {
    const decks = [];

    for (const file of this.files) {
      const contents = file.contents?.toString();
      if (!contents) {
        continue;
      }

      let result: { cards: Note[]; deckName: string; clean?: boolean } | null =
        null;

      if (isHTMLFile(file.name)) {
        result = this.parseHTMLFile(contents, file.name);
      } else if (isMarkdownFile(file.name) || isPlainText(file.name)) {
        result = this.parseTextFile(contents, file.name);
      } else if (isCSVFile(file.name)) {
        result = this.parseCSVFile(file.contents as Uint8Array, file.name);
      }

      if (!result || result.cards.length === 0) {
        continue;
      }

      const clean = result.clean !== false;

      // An explicit deck name wins over the filename, matching DeckParser and
      // making the `applied.deckName` the API reports back actually true.
      const deckName =
        settings.deckName != null && settings.deckName.trim() !== ''
          ? settings.deckName
          : result.deckName;

      decks.push(
        new Deck(
          deckName,
          clean ? Deck.CleanCards(result.cards) : result.cards,
          '',
          '',
          get16DigitRandomId(),
          settings
        )
      );
    }
    return decks;
  }
}

export default FallbackParser;
