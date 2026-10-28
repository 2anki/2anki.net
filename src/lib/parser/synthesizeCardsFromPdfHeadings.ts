export interface PdfPage {
  text: string;
  // Slide exports are landscape. The slide bullet rules below cannot tell a
  // slide from a page of notes by its glyphs, so they apply only when this is
  // true; any other page converts as it did before them.
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
const LIST_MARKER = /^(?:[-*•‣·☐☑☒✓✔■-◿←-⇿]|\d{1,3}[.)])(?:\s|$)/;
// On a slide, dingbats (➢ ❖ ♦) and the private-use code points that Symbol and
// Wingdings bullets from PowerPoint exports extract as (U+F0B7 …) are bullets
// too. The page render in extractPdfText joins text runs that share a baseline
// with no space, so a bullet or a level-2 dash drawn as a run of its own
// arrives glued to its text (`•Describe`, `–Explain`): a glyph needs no space
// after it, except before CJK text, where `■細胞の構造` is a heading, and a
// dash needs a letter or a space, so `–70 mV` stays a heading. A hyphen, `*`
// and numbers still need the space, or `-70 mV`, `-itis` and
// `2)Coordination costs` would read as bullets.
const SLIDE_LIST_MARKER =
  /^(?:[•‣·☐☑☒✓✔■-◿←-⇿➢➤❖♦\uF0B7\uF0A7\uF0D8\uF0FC\uF076](?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])|[–—]\p{L}|(?:[-*–—]|\d{1,3}[.)])(?:\s|$))/u;
const LONE_BULLET_GLYPH =
  /^[•‣·☐☑☒✓✔■-◿←-⇿➢➤❖♦\uF0B7\uF0A7\uF0D8\uF0FC\uF076]$/;
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
  return line != null && (LONE_BULLET_GLYPH.test(line) || LONE_DASH.test(line));
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
  const lines = page.text
    .split('\n')
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !isPageFooter(text));
  return page.landscape === true ? attachLoneMarkers(lines) : lines;
}

export function synthesizeCardsFromPdfHeadings(
  pages: PdfPage[],
  deckName: string
): PdfCard[] {
  const tag = deckName.replace(/\s+/g, '_');
  const lines = pages.flatMap((page, pageIndex) =>
    pageLines(page).map((text) => ({
      text,
      pageIndex,
      landscape: page.landscape === true,
    }))
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

  lines.forEach(({ text, pageIndex, landscape }, index) => {
    if (
      isHeadingLine(
        text,
        landscape ? SLIDE_LIST_MARKER : LIST_MARKER,
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
