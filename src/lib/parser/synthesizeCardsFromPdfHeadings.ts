import type { PdfCard, PdfPage } from './synthesizeCardsFromPdf';

const HEADING_MAX_CHARS = 60;
const SENTENCE_TAIL = /[.,;]$/;
const LIST_MARKER = /^(?:[-*•●○◦▪‣·☐☑☒✓✔]|\d{1,3}[.)])\s/;
const TERMINAL_PUNCTUATION = /[.!?:;]$/;
const PAGE_FOOTER =
  /^[-–—]?\s*(?:page\s+)?\d{1,4}(?:\s*(?:\/|of)\s*\d{1,4})?\s*[-–—]?$/i;

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
  const lines = pages
    .flatMap((page, pageIndex) =>
      page.text.split('\n').map((text) => ({ text, pageIndex }))
    )
    .map(({ text, pageIndex }) => ({ text: text.trim(), pageIndex }))
    .filter(({ text }) => text.length > 0 && !PAGE_FOOTER.test(text));

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
