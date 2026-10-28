export interface PdfPage {
  text: string;
  // Slide exports are landscape on every page. The slide rules below cannot
  // tell a slide from a page of notes by its glyphs, so they apply only when
  // every page is landscape: a PDF with any other page converts as it did
  // before them, and no page break can carry them onto a page of notes.
  landscape?: boolean;
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
// study notes; a bare marker with nothing after it is an empty list item the
// author forgot to delete, which arrives on a line of its own.
// Both glyph strings are spliced into regex character classes, so they hold
// BMP glyphs only (LIST_MARKER has no u flag), and their only "-" are the
// ranges ■-◿ and ←-⇿; another "-", "]" or literal backslash changes the match.
const NOTE_BULLET_GLYPHS = '•‣·☐☑☒✓✔■-◿←-⇿';
const LIST_MARKER = new RegExp(
  `^(?:[-*${NOTE_BULLET_GLYPHS}]|\\d{1,3}[.)])(?:\\s|$)`
);
// On slides, dingbats (➢ ❖ ♦) and the private-use code points that Symbol and
// Wingdings bullets from PowerPoint exports extract as (U+F0B7 …) are bullets
// too.
const SLIDE_BULLET_GLYPHS = `${NOTE_BULLET_GLYPHS}➢➤❖♦\uF0B7\uF0A7\uF0D8\uF0FC\uF076`;
// The page render in extractPdfText joins text runs that share a baseline with
// no space, so a bullet or a level-2 dash drawn as a run of its own arrives
// glued to its text (`•Describe`, `–Explain`): on a slide a glyph needs no
// space after it, and a dash needs a letter or a space, so `–70 mV` stays a
// heading. A hyphen, `*` and numbers still need the space, or `-70 mV`,
// `-itis` and `2)Coordination costs` would read as bullets.
const SLIDE_LIST_MARKER = new RegExp(
  `^(?:[${SLIDE_BULLET_GLYPHS}]|[–—]\\p{L}|(?:[-*–—]|\\d{1,3}[.)])(?:\\s|$))`,
  'u'
);
// Japanese, Chinese and Korean slides glue a glyph to every title, kana or
// kanji in it or not (`■細胞の構造`, `■ＤＮＡ`, `■ATP`), and a marker drawn
// apart from a title would join it and read as a bullet (`■ 細胞の構造`). So a
// page with any Han, kana or Hangul gets neither slide rule. Half-width and
// full-width forms (U+FF00-U+FFEF) and CJK punctuation (U+3000-U+303F) do
// not count: Latin slides carry them too (`：`, `￥`, an ideographic space).
const CJK_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LONE_BULLET_GLYPH = new RegExp(`^[${SLIDE_BULLET_GLYPHS}]$`, 'u');
const LONE_DASH = /^[–—]$/;
// On slides that draw every marker apart from its text, 42-46% of a page's
// lines measured as markers (a one-line title over two one-line bullets is
// 40%). Two stray glyphs are 7% of a 30-line notes page and 25% of an 8-line
// last page.
const DETACHED_MARKER_MIN_SHARE = 0.3;
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

function isLoneBulletGlyph(line: string): boolean {
  return LONE_BULLET_GLYPH.test(line);
}

function isLoneMarker(line: string | undefined): boolean {
  return line != null && (isLoneBulletGlyph(line) || LONE_DASH.test(line));
}

// extractPdfText starts a new line whenever the baseline changes, so a slide
// that draws each marker a little above or below its text puts every marker on
// a line of its own. A stray glyph (an empty bullet, a ↓ meaning "leads to")
// must stay put, or the heading after it turns into a list item; strays are a
// small share of a page, detached markers a large one. A lone dash is as often
// a divider as a sub-bullet, so dashes add to the share but cannot stand in
// for the two bullet glyphs. Only a marker with text after it on the page
// counts: one that ends the page or sits before another marker has nothing to
// belong to, so a forgotten empty bullet there cannot tip a page over the
// share.
function canAttach(lines: string[], index: number): boolean {
  const next = lines[index + 1];
  return isLoneMarker(lines[index]) && next != null && !isLoneMarker(next);
}

function drawsMarkersApart(lines: string[]): boolean {
  const attachable = lines.filter((_, index) => canAttach(lines, index));
  const glyphs = attachable.filter(isLoneBulletGlyph).length;
  return (
    glyphs >= 2 && attachable.length / lines.length >= DETACHED_MARKER_MIN_SHARE
  );
}

function attachLoneMarkers(lines: string[]): string[] {
  if (!drawsMarkersApart(lines)) {
    return lines;
  }
  const attached: string[] = [];
  lines.forEach((line, index) => {
    if (index > 0 && canAttach(lines, index - 1)) {
      attached[attached.length - 1] = `${lines[index - 1]} ${line}`;
    } else {
      attached.push(line);
    }
  });
  return attached;
}

function isHeadingLine(
  line: string,
  listMarker: RegExp,
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
    !listMarker.test(line) &&
    !startsLowercase(line) &&
    !isWrappedContinuation(previousLine) &&
    !isListSibling(line, nextLine, previousBodyLine)
  );
}

function pageLines(page: PdfPage): string[] {
  return page.text
    .split('\n')
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !isPageFooter(text));
}

function isSlideDeck(pages: PdfPage[]): boolean {
  return pages.length > 0 && pages.every((page) => page.landscape === true);
}

function hasCjkText(page: PdfPage): boolean {
  return CJK_CHARACTER.test(page.text);
}

export function synthesizeCardsFromPdfHeadings(
  pages: PdfPage[],
  deckName: string
): PdfCard[] {
  const tag = deckName.replace(/\s+/g, '_');
  const slideDeck = isSlideDeck(pages);
  const lines = pages.flatMap((page, pageIndex) => {
    const textLines = pageLines(page);
    const slidePage = slideDeck && !hasCjkText(page);
    const listMarker = slidePage ? SLIDE_LIST_MARKER : LIST_MARKER;
    return (slidePage ? attachLoneMarkers(textLines) : textLines).map(
      (text) => ({ text, pageIndex, listMarker })
    );
  });

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

  lines.forEach(({ text, pageIndex, listMarker }, index) => {
    if (
      isHeadingLine(
        text,
        listMarker,
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
