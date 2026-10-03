import { describe, expect, it } from 'vitest';
import getAcceptedContentTypes, {
  ACCEPTED_FORMATS,
  ACCEPTED_EXTENSIONS,
  formatAcceptedFormats,
} from './getAcceptedContentTypes';

describe('accepted formats single source of truth', () => {
  it('lists the common formats shown as pills and named in the error', () => {
    expect([...ACCEPTED_FORMATS]).toEqual([
      '.zip',
      '.html',
      '.md',
      '.pdf',
      '.docx',
      '.xlsx',
      '.pptx',
      '.csv',
      '.epub',
      '.opml',
      '.txt',
    ]);
  });

  it('keeps every server-accepted extension in the file-picker accept list', () => {
    const accept = getAcceptedContentTypes();
    for (const ext of [
      ...ACCEPTED_FORMATS,
      '.tsv',
      '.doc',
      '.ppt',
      '.xml',
      '.brainstorms.json',
    ]) {
      expect(accept).toContain(ext);
    }
  });

  it('exposes the accept list as the display list plus picker-only aliases', () => {
    expect(getAcceptedContentTypes()).toBe(ACCEPTED_EXTENSIONS.join(','));
    for (const fmt of ACCEPTED_FORMATS) {
      expect(ACCEPTED_EXTENSIONS).toContain(fmt);
    }
  });

  it('formats the English list with a disjunction', () => {
    expect(formatAcceptedFormats('en')).toBe(
      '.zip, .html, .md, .pdf, .docx, .xlsx, .pptx, .csv, .epub, .opml, or .txt'
    );
  });

  it('localizes the disjunction word', () => {
    expect(formatAcceptedFormats('de')).toContain('.opml oder .txt');
  });

  it('falls back to a comma list when Intl.ListFormat is unavailable', () => {
    const original = Intl.ListFormat;
    try {
      (Intl as unknown as { ListFormat?: unknown }).ListFormat = undefined;
      expect(formatAcceptedFormats('en')).toBe(
        '.zip, .html, .md, .pdf, .docx, .xlsx, .pptx, .csv, .epub, .opml, .txt'
      );
    } finally {
      (Intl as unknown as { ListFormat?: unknown }).ListFormat = original;
    }
  });
});
