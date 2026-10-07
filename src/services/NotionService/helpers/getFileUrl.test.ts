import { vi } from 'vitest';
import {
  FileBlockObjectResponse,
  PdfBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { getFileUrl } from './getFileUrl';

vi.mock('@notionhq/client', () => ({
  isFullBlock: () => true,
}));

function fileBlock(type: string, extra: object): FileBlockObjectResponse {
  return {
    object: 'block',
    id: 'b',
    type: 'file',
    has_children: false,
    archived: false,
    file: { type, ...extra },
  } as unknown as FileBlockObjectResponse;
}

function pdfBlock(type: string, extra: object): PdfBlockObjectResponse {
  return {
    object: 'block',
    id: 'b',
    type: 'pdf',
    has_children: false,
    archived: false,
    pdf: { type, ...extra },
  } as unknown as PdfBlockObjectResponse;
}

describe('getFileUrl', () => {
  test('returns url for external file', () => {
    const block = fileBlock('external', {
      external: { url: 'https://example.com/notes.pdf' },
    });
    expect(getFileUrl(block)).toBe('https://example.com/notes.pdf');
  });

  test('returns url for hosted file', () => {
    const block = fileBlock('file', {
      file: { url: 'https://s3.example.com/notes.pdf', expiry_time: '' },
    });
    expect(getFileUrl(block)).toBe('https://s3.example.com/notes.pdf');
  });

  test('returns url for hosted pdf block', () => {
    const block = pdfBlock('file', {
      file: { url: 'https://s3.example.com/slides.pdf', expiry_time: '' },
    });
    expect(getFileUrl(block)).toBe('https://s3.example.com/slides.pdf');
  });

  test('returns null for unsupported file type instead of a bad URL string', () => {
    const block = fileBlock('unsupported_type' as never, {});
    expect(getFileUrl(block)).toBeNull();
  });
});
