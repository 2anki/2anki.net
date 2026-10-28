import path from 'node:path';
import type { SlideUnit } from '../parser/sourceUnits/extractPptxSourceUnits';
import { SLIDE_SOURCE_ATTRIBUTE } from '../parser/slideSource';

// Node writes a path to disk as UTF-8, which turns a lone surrogate (from a
// multipart filename*, a Dropbox or Drive name, an MCP filename) into U+FFFD.
// Encoding that same text keeps encodeURIComponent from throwing.
function asWrittenToDisk(segment: string): string {
  return Buffer.from(segment, 'utf8').toString('utf8');
}

// Page images are named after the upload, and the parser looks an image up
// by decodeURIComponent(src), so each path segment is encoded: the decode
// gives back the page's path as Node wrote it, and a `"` cannot end the
// attribute early.
function toSrc(imagePath: string, workspaceLocation?: string): string {
  const segments = workspaceLocation
    ? path.relative(workspaceLocation, imagePath).split(path.sep)
    : [path.basename(imagePath)];
  return segments
    .map((segment) => encodeURIComponent(asWrittenToDisk(segment)))
    .join('/');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function bulletList(paragraphs: string[]): string {
  if (paragraphs.length === 0) return '';
  const items = paragraphs.map((p) => `<li>${p}</li>`).join('');
  return `<ul>${items}</ul>`;
}

function speakerNotesBlock(notes: string): string {
  const lines = notes
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';
  const body = lines.map((line) => `<p>${line}</p>`).join('');
  return `<hr />${body}`;
}

const LETTER = /\p{L}/u;
const XML_ENTITY_REFERENCE = /&(?:[a-z]+|#\d+|#x[\da-f]+);/gi;

function hasLetter(paragraph: string): boolean {
  return LETTER.test(paragraph.replaceAll(XML_ENTITY_REFERENCE, ' '));
}

function frontParagraphIndex(paragraphs: string[]): number {
  const firstWithLetter = paragraphs.findIndex((paragraph) =>
    hasLetter(paragraph)
  );
  return firstWithLetter === -1 ? 0 : firstWithLetter;
}

function toggleCard(front: string, back: string): string {
  return `<ul class="toggle">
    <li>
      <details>
        <summary>${front}</summary>${back}</details>
    </li>
    </ul>`;
}

// A back with no text of its own (only the slide image, or nothing) gets the
// slide's chrome as one source line: a list would read like an answer,
// and overlapping cloze would turn each line into a note of its own.
function chromeSourceLine(chromeParagraphs: string[]): string {
  return chromeParagraphs.length === 0
    ? ''
    : `<p ${SLIDE_SOURCE_ATTRIBUTE}>${chromeParagraphs.join(' · ')}</p>`;
}

// Called only when every slide has its rendered image, so every slide gets a
// front.
function slideCard(slide: SlideUnit, image: string): string {
  let front = slide.title;
  let remaining = slide.paragraphs;
  let imageOnBack = image;

  if (front === '' && remaining.length > 0) {
    const frontIndex = frontParagraphIndex(remaining);
    front = remaining[frontIndex];
    remaining = remaining.filter((_, i) => i !== frontIndex);
  }
  if (front === '') {
    front = image;
    imageOnBack = '';
  }

  const bullets = bulletList(remaining);
  const notes = speakerNotesBlock(slide.speakerNotes);
  const source =
    bullets === '' && notes === ''
      ? chromeSourceLine(slide.chromeParagraphs)
      : '';

  return toggleCard(front, `${bullets}${imageOnBack}${notes}${source}`);
}

// The card the slide made before chrome was set apart: its first line, chrome
// included, on the front, or its image when it has no text.
function slideCardWithChrome(slide: SlideUnit, image: string): string | null {
  const [firstLine = '', ...remaining] = slide.textWithChrome;
  const front = firstLine === '' ? image : firstLine;
  if (front === '') {
    console.warn('[combineSlidesIntoHTML] slide has nothing to show', {
      slide: slide.id,
    });
    return null;
  }
  const imageOnBack = firstLine === '' ? '' : image;

  return toggleCard(
    front,
    `${bulletList(remaining)}${imageOnBack}${speakerNotesBlock(
      slide.speakerNotes
    )}`
  );
}

function slideImage(
  imagePaths: string[],
  index: number,
  workspaceLocation?: string
): string {
  const imagePath = imagePaths[index];
  return imagePath == null
    ? ''
    : `<img src="${toSrc(imagePath, workspaceLocation)}" />`;
}

function slidesDocument(title: string, cards: string[]): string {
  return `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
  ${cards.join('\n')}
</body>
</html>`;
}

// The deck as it converted before chrome detection: chrome read as slide
// text, each rendered image where it went then.
export function combineSlidesWithChromeIntoHTML(
  slides: SlideUnit[],
  imagePaths: string[],
  title: string,
  workspaceLocation?: string
): string {
  const cards = slides
    .map((slide, i) =>
      slideCardWithChrome(slide, slideImage(imagePaths, i, workspaceLocation))
    )
    .filter((card): card is string => card !== null);
  return slidesDocument(title, cards);
}

// One card per slide, in display order, with the rendered slide image on the
// back so diagrams survive. The i-th image is the i-th visible slide: hidden
// slides are already dropped by the extractor because LibreOffice leaves them
// out of the PDF.
export function combineSlidesIntoHTML(
  slides: SlideUnit[],
  imagePaths: string[],
  title: string,
  workspaceLocation?: string
): string {
  // Chrome is set apart only when each slide has exactly its own rendered
  // image, which fronts a slide that has nothing else to front it. Without
  // slide images (Process PDF files off), with fewer pages than slides, or
  // with more (the extractor skipped a slide the PDF kept, so page i may not
  // be slide i), the deck converts as it did before chrome detection.
  if (imagePaths.length !== slides.length) {
    return combineSlidesWithChromeIntoHTML(
      slides,
      imagePaths,
      title,
      workspaceLocation
    );
  }
  const cards = slides.map((slide, i) =>
    slideCard(slide, slideImage(imagePaths, i, workspaceLocation))
  );
  return slidesDocument(title, cards);
}
