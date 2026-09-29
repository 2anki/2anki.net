import { unzipSync } from 'fflate';
import { SourceUnit, SourceUnitRole } from './SourceUnit';

const SLIDE_PATTERN = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_PATTERN = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
const PRESENTATION_XML = 'ppt/presentation.xml';
const PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels';

export interface SlideUnit extends SourceUnit {
  title: string;
  paragraphs: string[];
  hasPicture: boolean;
}

function extractParagraphs(xml: string): string[] {
  const texts: string[] = [];
  const runPattern = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let match: RegExpExecArray | null;
  const paragraphPattern = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let paraMatch: RegExpExecArray | null;

  while ((paraMatch = paragraphPattern.exec(xml)) !== null) {
    const paraContent = paraMatch[1];
    const paraTexts: string[] = [];
    runPattern.lastIndex = 0;
    while ((match = runPattern.exec(paraContent)) !== null) {
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
  return /<p:sld\b[^>]*\sshow="0"/.test(slideXml);
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
  const shapePattern = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  let title = '';
  const paragraphs: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = shapePattern.exec(slideXml)) !== null) {
    const shapeParagraphs = extractParagraphs(match[0]);
    if (shapeParagraphs.length === 0) continue;
    if (title === '' && isTitleShape(match[0])) {
      title = shapeParagraphs.join(' ');
    } else {
      paragraphs.push(...shapeParagraphs);
    }
  }

  return { title, paragraphs };
}

function extractNotesText(notesXml: string): string {
  const bodyPhPattern = /<p:sp\b[\s\S]*?<p:ph\s[^>]*idx="1"[\s\S]*?<\/p:sp>/g;
  let match: RegExpExecArray | null;

  while ((match = bodyPhPattern.exec(notesXml)) !== null) {
    const text = extractParagraphs(match[0]).join('\n');
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
  const sldIdPattern = /<p:sldId\b[^>]*\sr:id="([^"]+)"/g;
  const presentationXml = new TextDecoder().decode(presentation);
  let sldId: RegExpExecArray | null;
  while ((sldId = sldIdPattern.exec(presentationXml)) !== null) {
    const num = targetById.get(sldId[1]);
    if (num != null && known.has(num)) {
      order.push(num);
    }
  }

  return order.length > 0 ? order : null;
}

export async function extractPptxSourceUnits(
  pptxBuffer: Buffer
): Promise<SlideUnit[]> {
  const zip = unzipSync(new Uint8Array(pptxBuffer));

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
