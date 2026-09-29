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
      if (file.size > file.originalSize * 4 + 1024) return false;
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
    if (!isExactTagName(xml, start + open.length)) {
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

function isExactTagName(xml: string, nameEnd: number): boolean {
  const afterName = xml[nameEnd];
  return afterName === '>' || afterName === '/' || /\s/.test(afterName ?? '');
}

// Every `<tag ...>` open tag as its own slice, so attribute regexes run over
// one tag at a time instead of backtracking across the whole document.
function openTags(xml: string, tag: string): string[] {
  const open = `<${tag}`;
  const tags: string[] = [];
  let from = 0;

  while (from < xml.length) {
    const start = xml.indexOf(open, from);
    if (start === -1) break;
    if (!isExactTagName(xml, start + open.length)) {
      from = start + open.length;
      continue;
    }
    const openEnd = xml.indexOf('>', start);
    if (openEnd === -1) break;
    tags.push(xml.slice(start, openEnd + 1));
    from = openEnd + 1;
  }

  return tags;
}

function hasAttribute(xml: string, tag: string, attribute: RegExp): boolean {
  return openTags(xml, tag).some((openTag) => attribute.test(openTag));
}

function textRuns(paragraph: string): string[] {
  const runs: string[] = [];
  let from = 0;

  while (from < paragraph.length) {
    const start = paragraph.indexOf('<a:t', from);
    if (start === -1) break;
    if (!isExactTagName(paragraph, start + 4)) {
      from = start + 4;
      continue;
    }
    const openEnd = paragraph.indexOf('>', start);
    if (openEnd === -1) break;
    if (paragraph[openEnd - 1] === '/') {
      from = openEnd + 1;
      continue;
    }
    const close = paragraph.indexOf('</a:t>', openEnd);
    if (close === -1) break;
    const text = paragraph.slice(openEnd + 1, close);
    if (!text.includes('<') && text.trim()) {
      runs.push(text);
    }
    from = close + '</a:t>'.length;
  }

  return runs;
}

function extractParagraphs(xml: string): string[] {
  const texts: string[] = [];

  for (const paragraph of tagBlocks(xml, 'a:p')) {
    const paraTexts = textRuns(paragraph);
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
  return hasAttribute(slideXml, 'p:sld', /\sshow="(?:0|false)"/);
}

function isTitleShape(shapeXml: string): boolean {
  return hasAttribute(shapeXml, 'p:ph', /\stype="(?:title|ctrTitle)"/);
}

function inferRole(slideXml: string, visibleText: string): SourceUnitRole {
  if (visibleText.trim() === '') {
    return hasPicture(slideXml) ? 'image' : 'body';
  }
  if (hasAttribute(slideXml, 'p:ph', /\stype="title"/)) {
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
    if (!hasAttribute(shape, 'p:ph', /\sidx="1"/)) continue;
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
  const relsXml = new TextDecoder().decode(rels);
  for (const rel of openTags(relsXml, 'Relationship')) {
    const id = /\sId="([^"]+)"/.exec(rel)?.[1];
    const target = /\sTarget="([^"]*)"/.exec(rel)?.[1];
    const slideNumber =
      target == null ? null : /slides\/slide(\d+)\.xml$/.exec(target)?.[1];
    if (id != null && slideNumber != null) {
      targetById.set(id, Number.parseInt(slideNumber, 10));
    }
  }

  const order: number[] = [];
  const seen = new Set<number>();
  const presentationXml = new TextDecoder().decode(presentation);
  for (const sldIdTag of openTags(presentationXml, 'p:sldId')) {
    const relId = /\sr:id="([^"]+)"/.exec(sldIdTag)?.[1];
    const num = relId == null ? undefined : targetById.get(relId);
    if (num != null && known.has(num) && !seen.has(num)) {
      seen.add(num);
      order.push(num);
    }
  }

  return order.length > 0 ? order : null;
}

export function extractPptxSourceUnits(pptxBuffer: Buffer): SlideUnit[] {
  const zip = unzipNeededParts(pptxBuffer);

  const slideEntries: Map<number, string> = new Map();
  const notesEntries: Map<number, string> = new Map();

  for (const name of Object.keys(zip)) {
    const slideMatch = SLIDE_PATTERN.exec(name);
    if (slideMatch) {
      const num = Number.parseInt(slideMatch[1], 10);
      slideEntries.set(num, new TextDecoder().decode(zip[name]));
    }
    const notesMatch = NOTES_PATTERN.exec(name);
    if (notesMatch) {
      const num = Number.parseInt(notesMatch[1], 10);
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
