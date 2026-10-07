import { vi, type MockedFunction } from 'vitest';
import { extractPdfText, PdfExtractionResult } from './extractPdfText';

vi.mock('pdf-parse', () => {
  return { default: vi.fn() };
});

import pdfParse from 'pdf-parse';

const mockPdfParse = pdfParse as MockedFunction<typeof pdfParse>;

const FIXTURE_BUFFER = Buffer.from('fake-pdf-bytes');

describe('extractPdfText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns page texts and metadata for a normal PDF', async () => {
    mockPdfParse.mockResolvedValueOnce({
      numpages: 3,
      text: 'Introduction\nThis is page one.\n\nHeading Two\nContent on page two.\n\nConclusion\nFinal summary here.',
      info: {},
      metadata: null,
      version: 'v1.10.100' as const,
      numrender: 3,
    });

    const result: PdfExtractionResult = await extractPdfText(FIXTURE_BUFFER);

    expect(result.isDrmLocked).toBe(false);
    expect(result.needsCredential).toBe(false);
    expect(result.pageCount).toBe(3);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.avgCharsPerPage).toBeGreaterThan(10);
  });

  it('detects DRM-locked PDFs where average chars per page is below threshold', async () => {
    mockPdfParse.mockResolvedValueOnce({
      numpages: 10,
      text: '',
      info: {},
      metadata: null,
      version: 'v1.10.100' as const,
      numrender: 0,
    });

    const result = await extractPdfText(FIXTURE_BUFFER);

    expect(result.isDrmLocked).toBe(true);
    expect(result.needsCredential).toBe(false);
    expect(result.pageCount).toBe(10);
  });

  it('handles a single page PDF', async () => {
    mockPdfParse.mockResolvedValueOnce({
      numpages: 1,
      text: 'What is the capital of France?\nParis is the capital of France.',
      info: {},
      metadata: null,
      version: 'v1.10.100' as const,
      numrender: 1,
    });

    const result = await extractPdfText(FIXTURE_BUFFER);

    expect(result.isDrmLocked).toBe(false);
    expect(result.needsCredential).toBe(false);
    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
  });

  it('returns needsCredential true when pdf-parse throws a PasswordException', async () => {
    const passwordError = new Error('No password given');
    passwordError.name = 'PasswordException';
    mockPdfParse.mockRejectedValueOnce(passwordError);

    const result = await extractPdfText(FIXTURE_BUFFER);

    expect(result.needsCredential).toBe(true);
    expect(result.isDrmLocked).toBe(false);
    expect(result.pageCount).toBe(0);
    expect(result.pages).toHaveLength(0);
  });

  it('returns needsCredential true for encrypted PDF with wrong credential', async () => {
    const passwordError = new Error('Incorrect Password');
    passwordError.name = 'PasswordException';
    mockPdfParse.mockRejectedValueOnce(passwordError);

    const result = await extractPdfText(FIXTURE_BUFFER, 'wrong-password');

    expect(result.needsCredential).toBe(true);
    expect(result.isDrmLocked).toBe(false);
  });

  it('propagates non-password pdf-parse errors', async () => {
    mockPdfParse.mockRejectedValueOnce(new Error('Invalid PDF structure'));

    await expect(extractPdfText(FIXTURE_BUFFER)).rejects.toThrow(
      'Invalid PDF structure'
    );
  });

  it('disables font face on the pdf.js global settings object Node actually reads', () => {
    const pdfjs = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
    // pdf.js resolves `disableFontFace` from `globalScope.PDFJS`, re-exported as
    // `pdfjs.PDFJS` — a different object from the module root. Setting the flag
    // on the module root (the prior fix) is a silent no-op, so the FontLoader
    // still touches `document` and floods the log. Assert the object the engine
    // reads, not the one that merely looks set.
    expect(pdfjs.PDFJS).not.toBe(pdfjs);
    expect(pdfjs.PDFJS.disableFontFace).toBe(true);
  });

  it('installs a no-op Image global so JPEG decode never throws in Node', async () => {
    const globalWithImage = globalThis as {
      Image?: new () => { onload: (() => void) | null; src: string };
    };
    expect(typeof globalWithImage.Image).toBe('function');

    const img = new globalWithImage.Image!();
    const resolved = new Promise<void>((resolve) => {
      img.onload = () => resolve();
    });
    expect(() => {
      img.src = 'data:image/jpeg;base64,/9j/';
    }).not.toThrow();
    await expect(resolved).resolves.toBeUndefined();
  });

  it('passes credential to pdfParse as userPassword option', async () => {
    mockPdfParse.mockResolvedValueOnce({
      numpages: 2,
      text: 'Secure content on page one.\n\nMore secure content on page two.',
      info: {},
      metadata: null,
      version: 'v1.10.100' as const,
      numrender: 2,
    });

    const result = await extractPdfText(FIXTURE_BUFFER, 'correct-password');

    expect(mockPdfParse).toHaveBeenCalledWith(
      FIXTURE_BUFFER,
      expect.objectContaining({ userPassword: 'correct-password' })
    );
    expect(result.needsCredential).toBe(false);
    expect(result.isDrmLocked).toBe(false);
    expect(result.pageCount).toBe(2);
  });
});
