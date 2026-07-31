import { extractPdfText } from '../../../lib/parser/extractPdfText';
import {
  synthesizeCardsFromPdf,
  PdfCard,
} from '../../../lib/parser/synthesizeCardsFromPdf';
import { synthesizeCardsFromPdfHeadings } from '../../../lib/parser/synthesizeCardsFromPdfHeadings';
import { isTextShapedPdf } from '../../../lib/parser/isTextShapedPdf';
import path from 'path';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cardToToggle(front: string, back: string): string {
  const escapedFront = escapeHtml(front).replace(/\n/g, '<br>');
  const escapedBack = escapeHtml(back).replace(/\n/g, '<br>');
  return `<ul class="toggle">
  <li>
    <details>
      <summary>${escapedFront}</summary>
      <p>${escapedBack}</p>
    </details>
  </li>
</ul>`;
}

export interface ConvertPdfTextToHtmlResult {
  html: string;
  cardCount: number;
  isDrmLocked: boolean;
  needsCredential: boolean;
  droppedImageCount: number;
}

export interface ConvertPdfTextToHtmlAutoResult extends ConvertPdfTextToHtmlResult {
  isTextShaped: boolean;
  overSplit: boolean;
  pageCount: number;
}

export const MAX_CARDS_PER_PAGE = 15;

function renderCardsAsHtml(title: string, cards: PdfCard[]): string {
  const toggles = cards.map((c) => cardToToggle(c.front, c.back)).join('\n');
  return `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
${toggles}
</body>
</html>`;
}

export async function convertPdfTextToHtml(
  buffer: Buffer,
  name: string,
  credential?: string
): Promise<ConvertPdfTextToHtmlResult> {
  const title = path.basename(name, path.extname(name));
  const extraction = await extractPdfText(buffer, credential);

  if (extraction.needsCredential) {
    return {
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: true,
      droppedImageCount: 0,
    };
  }

  if (extraction.isDrmLocked) {
    return {
      html: '',
      cardCount: 0,
      isDrmLocked: true,
      needsCredential: false,
      droppedImageCount: 0,
    };
  }

  const cards = synthesizeCardsFromPdf(extraction.pages, title);
  const html = renderCardsAsHtml(title, cards);

  return {
    html,
    cardCount: cards.length,
    isDrmLocked: false,
    needsCredential: false,
    droppedImageCount: extraction.pages.reduce(
      (sum, p) => sum + p.imagePaintCount,
      0
    ),
  };
}

export async function convertPdfTextToHtmlAuto(
  buffer: Buffer,
  name: string,
  credential?: string
): Promise<ConvertPdfTextToHtmlAutoResult> {
  const title = path.basename(name, path.extname(name));
  const extraction = await extractPdfText(buffer, credential);

  if (extraction.needsCredential) {
    return {
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: true,
      droppedImageCount: 0,
      isTextShaped: false,
      overSplit: false,
      pageCount: extraction.pageCount,
    };
  }

  if (extraction.isDrmLocked) {
    return {
      html: '',
      cardCount: 0,
      isDrmLocked: true,
      needsCredential: false,
      droppedImageCount: 0,
      isTextShaped: false,
      overSplit: false,
      pageCount: extraction.pageCount,
    };
  }

  if (!isTextShapedPdf(extraction)) {
    return {
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: false,
      droppedImageCount: 0,
      isTextShaped: false,
      overSplit: false,
      pageCount: extraction.pageCount,
    };
  }

  const cards = synthesizeCardsFromPdfHeadings(extraction.pages, title);
  const cardsPerPage = cards.length / Math.max(extraction.pageCount, 1);
  const overSplit = cardsPerPage > MAX_CARDS_PER_PAGE;
  const html = overSplit ? '' : renderCardsAsHtml(title, cards);

  return {
    html,
    cardCount: cards.length,
    isDrmLocked: false,
    needsCredential: false,
    droppedImageCount: extraction.pages.reduce(
      (sum, p) => sum + p.imagePaintCount,
      0
    ),
    isTextShaped: true,
    overSplit,
    pageCount: extraction.pageCount,
  };
}
