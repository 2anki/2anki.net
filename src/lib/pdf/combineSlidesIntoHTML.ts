import path from 'node:path';
import type { SlideUnit } from '../parser/sourceUnits/extractPptxSourceUnits';

function toSrc(imagePath: string, workspaceLocation?: string): string {
  return workspaceLocation
    ? path.relative(workspaceLocation, imagePath).replaceAll('\\', '/')
    : path.basename(imagePath);
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

  const answer = `${bulletList(remaining)}${imageOnBack}${speakerNotesBlock(
    slide.speakerNotes
  )}`;
  const back = answer === '' ? bulletList(slide.chromeParagraphs) : answer;

  return toggleCard(front, back);
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
  // Chrome is set apart only when every slide has its rendered image, which
  // fronts a slide that has nothing else to front it. Without slide images
  // (Process PDF files off), or with fewer pages than slides, the deck
  // converts exactly as it did before chrome detection.
  const everySlideHasAnImage = imagePaths.length >= slides.length;
  const cards = slides
    .map((slide, i) => {
      const imagePath = imagePaths[i];
      const image =
        imagePath == null
          ? ''
          : `<img src="${toSrc(imagePath, workspaceLocation)}" />`;
      return everySlideHasAnImage
        ? slideCard(slide, image)
        : slideCardWithChrome(slide, image);
    })
    .filter((card): card is string => card !== null);

  return `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
  ${cards.join('\n')}
</body>
</html>`;
}
