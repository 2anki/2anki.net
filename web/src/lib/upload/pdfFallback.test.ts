// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetPdfFallback,
  mayNeedPdfQuestion,
  parsePdfFallbackHeader,
  readPdfChoicePrompt,
  readRememberedPdfFallback,
  rememberPdfFallback,
} from './pdfFallback';

describe('remembered PDF choice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('remembers a choice and forgets it again', () => {
    expect(readRememberedPdfFallback()).toBeNull();
    rememberPdfFallback('single');
    expect(readRememberedPdfFallback()).toBe('single');
    forgetPdfFallback();
    expect(readRememberedPdfFallback()).toBeNull();
  });

  it('ignores anything but the two modes', () => {
    localStorage.setItem('pdf-fallback', 'ask');
    expect(readRememberedPdfFallback()).toBeNull();
    localStorage.setItem('pdf-fallback', 'toString');
    expect(readRememberedPdfFallback()).toBeNull();
  });
});

describe('readPdfChoicePrompt', () => {
  it('reads the 409 body', () => {
    expect(
      readPdfChoicePrompt({
        code: 'choose_pdf_mode',
        reason: 'no_text',
        page_count: 14,
      })
    ).toEqual({ reason: 'no_text', pageCount: 14 });
  });

  it.each([
    null,
    'x',
    { code: 'unknown' },
    { code: 'choose_pdf_mode', reason: 'weird' },
  ])('answers null for %j', (body) => {
    expect(readPdfChoicePrompt(body)).toBeNull();
  });
});

describe('small helpers', () => {
  it('parses the response header', () => {
    expect(parsePdfFallbackHeader('pairs')).toBe('pairs');
    expect(parsePdfFallbackHeader('single')).toBe('single');
    expect(parsePdfFallbackHeader('x')).toBeNull();
    expect(parsePdfFallbackHeader(null)).toBeNull();
  });

  it('asks only for PDFs and zips', () => {
    expect(mayNeedPdfQuestion([new File(['x'], 'a.PDF')])).toBe(true);
    expect(mayNeedPdfQuestion([new File(['x'], 'a.zip')])).toBe(true);
    expect(mayNeedPdfQuestion([new File(['x'], 'a.md')])).toBe(false);
  });
});
