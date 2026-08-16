import type { DocFrontmatter } from './loader';

const TITLE_SUFFIX = ' — 2anki docs';
const DEFAULT_TITLE = `Documentation${TITLE_SUFFIX}`;
const DESCRIPTION_MAX = 155;

export function buildDocTitle(frontmatterTitle?: string): string {
  if (frontmatterTitle != null && frontmatterTitle.length > 0) {
    return `${frontmatterTitle}${TITLE_SUFFIX}`;
  }
  return DEFAULT_TITLE;
}

export function buildDocDescription(
  frontmatter: DocFrontmatter,
  body: string
): string | undefined {
  if (frontmatter.description != null && frontmatter.description.length > 0) {
    return frontmatter.description;
  }
  const paragraph = firstParagraph(body);
  if (paragraph.length === 0) {
    return undefined;
  }
  return truncate(paragraph, DESCRIPTION_MAX);
}

function isSkippableLine(line: string): boolean {
  const markers = ['#', ':::', '<', '|', '-', '*', '>', '`', '!['];
  return (
    markers.some((marker) => line.startsWith(marker)) || /^\d+\./.test(line)
  );
}

function firstParagraph(body: string): string {
  const collected: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    if (isSkippableLine(line)) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    collected.push(line);
  }
  return stripMarkdown(collected.join(' '));
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const clipped = text.slice(0, max);
  const lastSpace = clipped.lastIndexOf(' ');
  const base = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.trimEnd()}…`;
}
