export interface PdfPage {
  text: string;
}

export interface PdfCard {
  front: string;
  back: string;
  tags: string[];
  // 0-based page the card's front came from, so per-page assets (extracted
  // figures) can be attached to the right card.
  pageIndex?: number;
}

const HEADING_MAX_CHARS = 60;
const SENTENCE_TAIL = /[.,;]$/;
// Geometric shapes (■ ▶ ◦ …) and arrows (→ ↓ …) are bullet glyphs in exported
// study notes and slides; a bare marker with nothing after it is an empty list
// item the author forgot to delete, which pdf.js emits on its own line. pdf.js
// glues a glyph drawn as its own text run to the text after it with no space,
// so a glyph needs none; dashes, `*` and numbers still do, or `-70 mV` and
// `2)Coordination costs` would read as bullets.
const LIST_MARKER = /^(?:[•‣·☐☑☒✓✔■-◿←-⇿]|(?:[-*–—]|\d{1,3}[.)])(?:\s|$))/;
const LONE_BULLET_GLYPH = /^[•‣·☐☑☒✓✔■-◿←-⇿]$/;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const TERMINAL_PUNCTUATION = /[.!?:;]$/;
const BARE_PAGE_NUMBER = /^[-–—]?\s*\d{1,3}\s*[-–—]?$/;
const PAGE_WORD_NUMBER = /^page\s+\d{1,4}$/i;
const PAGE_OF_TOTAL = /^\d{1,4}\s*(?:\/|of)\s*\d{1,4}$/i;

function isPageFooter(line: string): boolean {
  return (
    BARE_PAGE_NUMBER.test(line) ||
    PAGE_WORD_NUMBER.test(line) ||
    PAGE_OF_TOTAL.test(line)
  );
}

function startsLowercase(line: string): boolean {
  const first = line.charAt(0);
  return first !== first.toUpperCase();
}

function isWrappedContinuation(previousLine: string | undefined): boolean {
  return (
    previousLine != null &&
    previousLine.length >= HEADING_MAX_CHARS &&
    !TERMINAL_PUNCTUATION.test(previousLine)
  );
}

function isShortUnpunctuated(line: string | undefined): line is string {
  return (
    line != null &&
    line.length < HEADING_MAX_CHARS &&
    !TERMINAL_PUNCTUATION.test(line)
  );
}

function leadingWord(line: string): string {
  return line.split(/[\s:]/, 1)[0].toLowerCase();
}

function isListSibling(
  line: string,
  nextLine: string | undefined,
  previousBodyLine: string | undefined
): boolean {
  return (
    isShortUnpunctuated(previousBodyLine) &&
    isShortUnpunctuated(nextLine) &&
    leadingWord(previousBodyLine) === leadingWord(line)
  );
}

function isLoneBulletGlyph(line: string | undefined): boolean {
  return line != null && LONE_BULLET_GLYPH.test(line);
}

// One lone glyph on a page is a stray (an empty bullet, or a ↓ meaning "leads
// to") and stays where it is. Two or more mean the slide draws each bullet a
// little apart from its text, which pdf.js then emits on a line of its own.
function attachLoneBulletGlyphs(lines: string[]): string[] {
  if (lines.filter(isLoneBulletGlyph).length < 2) {
    return lines;
  }
  const attached: string[] = [];
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (isLoneBulletGlyph(previous) && !isLoneBulletGlyph(line)) {
      attached[attached.length - 1] = `${previous} ${line}`;
    } else {
      attached.push(line);
    }
  });
  return attached;
}

function isHeadingLine(
  line: string,
  nextLine: string | undefined,
  previousLine: string | undefined,
  previousBodyLine: string | undefined
): boolean {
  return (
    line.length < HEADING_MAX_CHARS &&
    nextLine != null &&
    nextLine.length > line.length &&
    WORD_CHARACTER.test(line) &&
    !SENTENCE_TAIL.test(line) &&
    !LIST_MARKER.test(line) &&
    !startsLowercase(line) &&
    !isWrappedContinuation(previousLine) &&
    !isListSibling(line, nextLine, previousBodyLine)
  );
}

export function synthesizeCardsFromPdfHeadings(
  pages: PdfPage[],
  deckName: string
): PdfCard[] {
  const tag = deckName.replace(/\s+/g, '_');
  const lines = pages.flatMap((page, pageIndex) =>
    attachLoneBulletGlyphs(
      page.text
        .split('\n')
        .map((text) => text.trim())
        .filter((text) => text.length > 0 && !isPageFooter(text))
    ).map((text) => ({ text, pageIndex }))
  );

  const cards: PdfCard[] = [];
  let front: string | null = null;
  let frontPageIndex = 0;
  let body: string[] = [];
  let previousBodyLine: string | undefined;

  const flushCard = () => {
    if (front != null && body.length > 0) {
      cards.push({
        front,
        back: body.join('\n'),
        tags: [tag],
        pageIndex: frontPageIndex,
      });
    }
  };

  lines.forEach(({ text, pageIndex }, index) => {
    if (
      isHeadingLine(
        text,
        lines[index + 1]?.text,
        lines[index - 1]?.text,
        previousBodyLine
      )
    ) {
      flushCard();
      front = text;
      frontPageIndex = pageIndex;
      body = [];
      previousBodyLine = undefined;
    } else {
      if (front != null) {
        body.push(text);
      }
      previousBodyLine = text;
    }
  });
  flushCard();

  return cards;
}
