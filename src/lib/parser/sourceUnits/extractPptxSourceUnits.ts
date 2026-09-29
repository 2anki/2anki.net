import { unzipSync } from 'fflate';
import { SourceUnit, SourceUnitRole } from './SourceUnit';

const SLIDE_PATTERN = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_PATTERN = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
const PRESENTATION_XML = 'ppt/presentation.xml';
const PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels';
const NEEDED_PART =
  /^ppt\/(?:slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml|presentation\.xml|_rels\/presentation\.xml\.rels)$/;

// Anonymous uploads reach this extractor, so the archive's own size claims
// bound what gets inflated: one part over the cap is skipped, and a deck whose
// needed parts add up past the budget is refused rather than decompressed.
export const MAX_PPTX_PART_BYTES = 8 * 1024 * 1024;
export const MAX_PPTX_TOTAL_BYTES = 64 * 1024 * 1024;

export class PptxTooLargeError extends Error {
  constructor() {
    super('This presentation is too large to read slide text from');
    this.name = 'PptxTooLargeError';
  }
}

export interface SlideUnit extends SourceUnit {
  title: string;
  paragraphs: string[];
  hasPicture: boolean;
}

function unzipNeededParts(pptxBuffer: Buffer): Record<string, Uint8Array> {
  let total = 0;
  let overBudget = false;
  const zip = unzipSync(new Uint8Array(pptxBuffer), {
    filter: (file) => {
      if (!NEEDED_PART.test(file.name)) return false;
      if (file.originalSize > MAX_PPTX_PART_BYTES) return false;
      total += file.originalSize;
      if (total > MAX_PPTX_TOTAL_BYTES) {
        overBudget = true;
        return false;
      }
      return true;
    },
  });
  if (overBudget) throw new PptxTooLargeError();
  return zip;
}

// Linear scan for `<tag ...>...</tag>` blocks. A lazy `[\s\S]*?` regex is
// quadratic when closing tags are missing, which a crafted slide can arrange.
function tagBlocks(xml: string, tag: string): string[] {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const blocks: string[] = [];
  let from = 0;

  while (from < xml.length) {
    const start = xml.indexOf(open, from);
    if (start === -1) break;
    const afterName = xml[start + open.length];
    const isExactTag =
      afterName === '>' || afterName === '/' || /\s/.test(afterName ?? '');
    if (!isExactTag) {
      from = start + open.length;
      continue;
    }
    const openEnd = xml.indexOf('>', start);
    if (openEnd === -1) break;
    if (xml[openEnd - 1] === '/') {
      from = openEnd + 1;
      continue;
    }
    const end = xml.indexOf(close, openEnd);
    if (end === -1) break;
    blocks.push(xml.slice(start, end + close.length));
    from = end + close.length;
  }

  return blocks;
}

function extractParagraphs(xml: string): string[] {
  const texts: string[] = [];
  const runPattern = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let match: RegExpExecArray | null;

  for (const paragraph of tagBlocks(xml, 'a:p')) {
    const paraTexts: string[] = [];
    runPattern.lastIndex = 0;
    while ((match = runPattern.exec(paragraph)) !== null) {
      const text = match[1];
      if (text.trim()) {
        paraTexts.push(text);
      }
    }
    if (paraTexts.length > 0) {
      texts.push(paraTexts.join(''));
    }
  }

  return texts;
}

function hasTextShapes(slideXml: string): boolean {
  return /<p:sp\b/.test(slideXml) && /<a:t\b/.test(slideXml);
}

function hasPicture(slideXml: string): boolean {
  return /<p:pic\b|<p:graphicFrame\b/.test(slideXml);
}

function isHidden(slideXml: string): boolean {
  return /<p:sld\b[^>]*\sshow="(?:0|false)"/.test(slideXml);
}

function isTitleShape(shapeXml: string): boolean {
  return /<p:ph\s[^>]*type="(?:title|ctrTitle)"/.test(shapeXml);
}

function inferRole(slideXml: string, visibleText: string): SourceUnitRole {
  if (visibleText.trim() === '') {
    return hasPicture(slideXml) ? 'image' : 'body';
  }
  if (/<p:ph\s[^>]*type="title"/.test(slideXml)) {
    return 'title';
  }
  return 'body';
}

function splitSlideText(slideXml: string): {
  title: string;
  paragraphs: string[];
} {
  let title = '';
  const paragraphs: string[] = [];

  for (const shape of tagBlocks(slideXml, 'p:sp')) {
    const shapeParagraphs = extractParagraphs(shape);
    if (shapeParagraphs.length === 0) continue;
    if (title === '' && isTitleShape(shape)) {
      title = shapeParagraphs.join(' ');
    } else {
      paragraphs.push(...shapeParagraphs);
    }
  }

  return { title, paragraphs };
}

function extractNotesText(notesXml: string): string {
  for (const shape of tagBlocks(notesXml, 'p:sp')) {
    if (!/<p:ph\s[^>]*idx="1"/.test(shape)) continue;
    const text = extractParagraphs(shape).join('\n');
    if (text.trim()) {
      return text.trim();
    }
  }

  return '';
}

// Slide files are numbered in creation order; the order the audience sees
// lives in presentation.xml, resolved through the package relationships.
function readDisplayOrder(
  zip: Record<string, Uint8Array>,
  known: Set<number>
): number[] | null {
  const presentation = zip[PRESENTATION_XML];
  const rels = zip[PRESENTATION_RELS];
  if (presentation == null || rels == null) return null;

  const targetById = new Map<string, number>();
  const relPattern = /<Relationship\b[^>]*>/g;
  const relsXml = new TextDecoder().decode(rels);
  let rel: RegExpExecArray | null;
  while ((rel = relPattern.exec(relsXml)) !== null) {
    const id = /\sId="([^"]+)"/.exec(rel[0])?.[1];
    const target = /\sTarget="[^"]*?slides\/slide(\d+)\.xml"/.exec(rel[0])?.[1];
    if (id != null && target != null) {
      targetById.set(id, parseInt(target, 10));
    }
  }

  const order: number[] = [];
  const seen = new Set<number>();
  const sldIdPattern = /<p:sldId\b[^>]*\sr:id="([^"]+)"/g;
  const presentationXml = new TextDecoder().decode(presentation);
  let sldId: RegExpExecArray | null;
  while ((sldId = sldIdPattern.exec(presentationXml)) !== null) {
    const num = targetById.get(sldId[1]);
    if (num != null && known.has(num) && !seen.has(num)) {
      seen.add(num);
      order.push(num);
    }
  }

  return order.length > 0 ? order : null;
}

export async function extractPptxSourceUnits(
  pptxBuffer: Buffer
): Promise<SlideUnit[]> {
  const zip = unzipNeededParts(pptxBuffer);

  const slideEntries: Map<number, string> = new Map();
  const notesEntries: Map<number, string> = new Map();

  for (const name of Object.keys(zip)) {
    const slideMatch = SLIDE_PATTERN.exec(name);
    if (slideMatch) {
      const num = parseInt(slideMatch[1], 10);
      slideEntries.set(num, new TextDecoder().decode(zip[name]));
    }
    const notesMatch = NOTES_PATTERN.exec(name);
    if (notesMatch) {
      const num = parseInt(notesMatch[1], 10);
      notesEntries.set(num, new TextDecoder().decode(zip[name]));
    }
  }

  const slideNumbers =
    readDisplayOrder(zip, new Set(slideEntries.keys())) ??
    [...slideEntries.keys()].sort((a, b) => a - b);

  return slideNumbers.flatMap((num) => {
    const slideXml = slideEntries.get(num)!;
    if (isHidden(slideXml)) return [];

    const notesXml = notesEntries.get(num) ?? '';
    const { title, paragraphs } = hasTextShapes(slideXml)
      ? splitSlideText(slideXml)
      : { title: '', paragraphs: [] };
    const visibleText = [title, ...paragraphs]
      .filter((text) => text !== '')
      .join('\n');
    const speakerNotes = notesXml ? extractNotesText(notesXml) : '';
    const role = inferRole(slideXml, visibleText);

    return [
      {
        id: `slide-${num}`,
        visibleText,
        speakerNotes,
        role,
        title,
        paragraphs,
        hasPicture: hasPicture(slideXml),
      },
    ];
  });
}
