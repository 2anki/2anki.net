import * as cheerio from 'cheerio';
import {
  isCSVFile,
  isHTMLFile,
  isMarkdownFile,
  isPDFFile,
  isPlainText,
} from '../storage/checks';
import type { PdfExtractionResult } from '../parser/extractPdfText';
import { AI_PREVIEW_MAX_INPUT_CHARS } from '../claude/aiPreview';

// Only the first pages feed the preview, so a lecture deck or a whole textbook
// costs the same bounded call as a one-pager.
export const AI_PREVIEW_MAX_PAGES = 5;

// The file types the preview can read text out of without the full parser
// pipeline. Everything else (slides, zips, images, docx) falls through to
// today's behaviour instead of a preview.
export function isAiPreviewExtractable(filename: string): boolean {
  return Boolean(
    isPDFFile(filename) ||
    isHTMLFile(filename) ||
    isMarkdownFile(filename) ||
    isPlainText(filename) ||
    isCSVFile(filename)
  );
}

export interface PreviewTextDeps {
  extractPdf?: (buffer: Buffer) => Promise<PdfExtractionResult>;
}

async function extractPdfPreview(
  bytes: Buffer,
  deps: PreviewTextDeps
): Promise<string | null> {
  const extract =
    deps.extractPdf ??
    (await import('../parser/extractPdfText')).extractPdfText;
  const result = await extract(bytes);
  if (result.isDrmLocked || result.needsCredential) {
    return null;
  }
  return result.pages
    .slice(0, AI_PREVIEW_MAX_PAGES)
    .map((page) => page.text)
    .join('\n\n');
}

function extractHtmlText(bytes: Buffer): string {
  const $ = cheerio.load(bytes.toString('utf-8'));
  $('style, script, head, link').remove();
  return $.root().text();
}

async function extractRaw(
  filename: string,
  bytes: Buffer,
  deps: PreviewTextDeps
): Promise<string | null> {
  if (isPDFFile(filename)) {
    return extractPdfPreview(bytes, deps);
  }
  if (isHTMLFile(filename)) {
    return extractHtmlText(bytes);
  }
  if (
    isMarkdownFile(filename) ||
    isPlainText(filename) ||
    isCSVFile(filename)
  ) {
    return bytes.toString('utf-8');
  }
  return null;
}

// Pulls a bounded text sample out of an uploaded file for the AI preview. The
// result is trimmed and hard-capped at AI_PREVIEW_MAX_INPUT_CHARS so the preview
// call's input is bounded before it ever reaches the model. Returns null when
// there is nothing readable (unsupported type, empty, DRM-locked PDF).
export async function extractPreviewText(
  filename: string,
  bytes: Buffer,
  deps: PreviewTextDeps = {}
): Promise<string | null> {
  const raw = await extractRaw(filename, bytes, deps);
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, AI_PREVIEW_MAX_INPUT_CHARS);
}
