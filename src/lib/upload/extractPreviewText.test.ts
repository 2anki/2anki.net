import { describe, it, expect } from 'vitest';
import { AI_PREVIEW_MAX_INPUT_CHARS } from '../claude/aiPreview';
import {
  AI_PREVIEW_MAX_PAGES,
  extractPreviewText,
  isAiPreviewExtractable,
} from './extractPreviewText';

function pdfResult(pageTexts: string[]) {
  return {
    pages: pageTexts.map((text) => ({ text, imagePaintCount: 0 })),
    pageCount: pageTexts.length,
    avgCharsPerPage: 100,
    isDrmLocked: false,
    needsCredential: false,
    coloredTextPageCount: 0,
  };
}

describe('isAiPreviewExtractable', () => {
  it('accepts pdf and text-like files, rejects the rest', () => {
    expect(isAiPreviewExtractable('notes.pdf')).toBe(true);
    expect(isAiPreviewExtractable('notes.html')).toBe(true);
    expect(isAiPreviewExtractable('notes.md')).toBe(true);
    expect(isAiPreviewExtractable('notes.txt')).toBe(true);
    expect(isAiPreviewExtractable('cards.csv')).toBe(true);
    expect(isAiPreviewExtractable('slides.pptx')).toBe(false);
    expect(isAiPreviewExtractable('export.zip')).toBe(false);
    expect(isAiPreviewExtractable('photo.png')).toBe(false);
  });
});

describe('extractPreviewText', () => {
  it('reads only the first pages of a pdf', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => `page ${i} text`);
    const text = await extractPreviewText('deck.pdf', Buffer.from('%PDF'), {
      extractPdf: async () => pdfResult(pages),
    });
    expect(text).toContain('page 0 text');
    expect(text).toContain(`page ${AI_PREVIEW_MAX_PAGES - 1} text`);
    expect(text).not.toContain(`page ${AI_PREVIEW_MAX_PAGES} text`);
  });

  it('caps the extracted text at the input bound for a huge file', async () => {
    const giant = 'B'.repeat(5_000_000);
    const text = await extractPreviewText('big.pdf', Buffer.from('%PDF'), {
      extractPdf: async () => pdfResult([giant]),
    });
    expect(text?.length).toBe(AI_PREVIEW_MAX_INPUT_CHARS);
  });

  it('returns null for a drm-locked pdf', async () => {
    const text = await extractPreviewText('locked.pdf', Buffer.from('%PDF'), {
      extractPdf: async () => ({ ...pdfResult(['x']), isDrmLocked: true }),
    });
    expect(text).toBeNull();
  });

  it('strips html tags to plain text', async () => {
    const html =
      '<html><head><style>p{}</style></head><body><h1>Title</h1><p>Body text</p></body></html>';
    const text = await extractPreviewText('notes.html', Buffer.from(html));
    expect(text).toContain('Title');
    expect(text).toContain('Body text');
    expect(text).not.toContain('<h1>');
    expect(text).not.toContain('p{}');
  });

  it('reads markdown and plain text verbatim', async () => {
    const md = '# Heading\n\nSome notes here';
    const text = await extractPreviewText('notes.md', Buffer.from(md));
    expect(text).toBe(md);
  });

  it('returns null for an unsupported file type', async () => {
    const text = await extractPreviewText('slides.pptx', Buffer.from('x'));
    expect(text).toBeNull();
  });

  it('returns null for an empty file', async () => {
    const text = await extractPreviewText('empty.txt', Buffer.from('   '));
    expect(text).toBeNull();
  });
});
