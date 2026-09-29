import path from 'path';
import type { SlideUnit } from '../parser/sourceUnits/extractPptxSourceUnits';

function toSrc(imagePath: string, workspaceLocation?: string): string {
  return workspaceLocation
    ? path.relative(workspaceLocation, imagePath).replaceAll('\\', '/')
    : path.basename(imagePath);
}

function bulletList(paragraphs: string[]): string {
  if (paragraphs.length === 0) return '';
  return `<ul>${paragraphs.map((p) => `<li>${p}</li>`).join('')}</ul>`;
}

function speakerNotesBlock(notes: string): string {
  const lines = notes
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';
  const body = lines.map((line) => `<p>${line}</p>`).join('');
  return `<hr /><p><strong>Speaker notes</strong></p>${body}`;
}

function slideCard(slide: SlideUnit, image: string): string | null {
  let front = slide.title;
  let remaining = slide.paragraphs;
  let imageOnBack = image;

  if (front === '' && remaining.length > 0) {
    front = remaining[0];
    remaining = remaining.slice(1);
  }
  if (front === '' && image !== '') {
    front = image;
    imageOnBack = '';
  }
  if (front === '') return null;

  const back = `${bulletList(remaining)}${imageOnBack}${speakerNotesBlock(
    slide.speakerNotes
  )}`;

  return `<ul class="toggle">
    <li>
      <details>
        <summary>${front}</summary>${back}</details>
    </li>
    </ul>`;
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
  const cards = slides
    .map((slide, i) => {
      const imagePath = imagePaths[i];
      const image =
        imagePath == null
          ? ''
          : `<img src="${toSrc(imagePath, workspaceLocation)}" />`;
      return slideCard(slide, image);
    })
    .filter((card): card is string => card !== null);

  return `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  ${cards.join('\n')}
</body>
</html>`;
}
