import { extractPdfText } from '../../../lib/parser/extractPdfText';
import {
  synthesizeCardsFromPdf,
  PdfCard,
} from '../../../lib/parser/synthesizeCardsFromPdf';
import { synthesizeCardsFromPdfHeadings } from '../../../lib/parser/synthesizeCardsFromPdfHeadings';
import { isTextShapedPdf } from '../../../lib/parser/isTextShapedPdf';
import { ExtractedPdfImage } from '../../../lib/pdf/extractPdfImages';
import path from 'path';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cardToToggle(front: string, back: string, imageTags = ''): string {
  const escapedFront = escapeHtml(front).replace(/\n/g, '<br>');
  const escapedBack = escapeHtml(back).replace(/\n/g, '<br>');
  return `<ul class="toggle">
  <li>
    <details>
      <summary>${escapedFront}</summary>
      <p>${escapedBack}${imageTags}</p>
    </details>
  </li>
</ul>`;
}

function imageTag(src: string): string {
  return `<img src="${escapeHtml(src)}">`;
}

interface PlacedPdfImage {
  pageIndex: number;
  src: string;
}

// Each page's figures ride the first card synthesized from that page, so
// image and text stay adjacent for both the AI prompt and the plain parser.
// Figures from pages that produced no card are appended after the toggles —
// still in the document, never silently dropped.
function buildImagePlacement(images: PlacedPdfImage[]) {
  const byPage = new Map<number, string[]>();
  for (const image of images) {
    const list = byPage.get(image.pageIndex) ?? [];
    list.push(image.src);
    byPage.set(image.pageIndex, list);
  }
  const tagsForCard = (card: PdfCard): string => {
    if (card.pageIndex == null) return '';
    const list = byPage.get(card.pageIndex);
    if (!list) return '';
    byPage.delete(card.pageIndex);
    return list.map(imageTag).join('');
  };
  const leftover = (): string =>
    Array.from(byPage.values())
      .flat()
      .map((src) => `<p>${imageTag(src)}</p>`)
      .join('\n');
  return { tagsForCard, leftover };
}

export interface PdfHtmlImage {
  name: string;
  contents: Buffer;
  size?: number;
}

// Called only once the text path is committed, so scanned/DRM/over-split
// PDFs never pay for embedded-image extraction they cannot use.
export type LoadPdfImages = () => Promise<ExtractedPdfImage[]>;

export interface ConvertPdfTextToHtmlResult {
  html: string;
  cardCount: number;
  isDrmLocked: boolean;
  needsCredential: boolean;
  droppedImageCount: number;
  images: PdfHtmlImage[];
}

export interface ConvertPdfTextToHtmlAutoResult extends ConvertPdfTextToHtmlResult {
  isTextShaped: boolean;
  overSplit: boolean;
  pageCount: number;
}

export const MAX_CARDS_PER_PAGE = 15;

function renderCardsAsHtml(
  title: string,
  cards: PdfCard[],
  images: PlacedPdfImage[] = []
): string {
  const placement = buildImagePlacement(images);
  const toggles = cards
    .map((c) => cardToToggle(c.front, c.back, placement.tagsForCard(c)))
    .join('\n');
  const trailing = placement.leftover();
  return `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(title)}</title></head>
<body>
${toggles}${trailing ? `\n${trailing}` : ''}
</body>
</html>`;
}

async function loadPlacedImages(
  loadImages: LoadPdfImages | undefined,
  pdfName: string
): Promise<{ placed: PlacedPdfImage[]; files: PdfHtmlImage[] }> {
  if (!loadImages) return { placed: [], files: [] };
  const extracted = await loadImages();
  // `<pdfName>-images/`, not `<pdfName>/` — the PDF itself is written to the
  // workspace under its own name, and a file and a directory cannot share one.
  const mediaDir = `${pdfName}-images`;
  return {
    placed: extracted.map((image) => ({
      pageIndex: image.pageIndex,
      src: `${mediaDir}/${image.name}`,
    })),
    files: extracted.map((image) => ({
      name: `${mediaDir}/${image.name}`,
      contents: image.contents,
    })),
  };
}

function remainingDroppedImages(
  paintedImageCount: number,
  embeddedCount: number
): number {
  return Math.max(0, paintedImageCount - embeddedCount);
}

export async function convertPdfTextToHtml(
  buffer: Buffer,
  name: string,
  credential?: string,
  loadImages?: LoadPdfImages
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
      images: [],
    };
  }

  if (extraction.isDrmLocked) {
    return {
      html: '',
      cardCount: 0,
      isDrmLocked: true,
      needsCredential: false,
      droppedImageCount: 0,
      images: [],
    };
  }

  const cards = synthesizeCardsFromPdf(extraction.pages, title);
  const { placed, files } = await loadPlacedImages(loadImages, name);
  const html = renderCardsAsHtml(title, cards, placed);

  return {
    html,
    cardCount: cards.length,
    isDrmLocked: false,
    needsCredential: false,
    droppedImageCount: remainingDroppedImages(
      extraction.pages.reduce((sum, p) => sum + p.imagePaintCount, 0),
      files.length
    ),
    images: files,
  };
}

export async function convertPdfTextToHtmlAuto(
  buffer: Buffer,
  name: string,
  credential?: string,
  loadImages?: LoadPdfImages
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
      images: [],
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
      images: [],
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
      images: [],
      isTextShaped: false,
      overSplit: false,
      pageCount: extraction.pageCount,
    };
  }

  const cards = synthesizeCardsFromPdfHeadings(extraction.pages, title);
  const cardsPerPage = cards.length / Math.max(extraction.pageCount, 1);
  const overSplit = cardsPerPage > MAX_CARDS_PER_PAGE;
  const paintedImageCount = extraction.pages.reduce(
    (sum, p) => sum + p.imagePaintCount,
    0
  );

  if (overSplit) {
    return {
      html: '',
      cardCount: cards.length,
      isDrmLocked: false,
      needsCredential: false,
      droppedImageCount: paintedImageCount,
      images: [],
      isTextShaped: true,
      overSplit,
      pageCount: extraction.pageCount,
    };
  }

  const { placed, files } = await loadPlacedImages(loadImages, name);
  const html = renderCardsAsHtml(title, cards, placed);

  return {
    html,
    cardCount: cards.length,
    isDrmLocked: false,
    needsCredential: false,
    droppedImageCount: remainingDroppedImages(paintedImageCount, files.length),
    images: files,
    isTextShaped: true,
    overSplit,
    pageCount: extraction.pageCount,
  };
}
