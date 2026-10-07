import { vi, type MockedFunction } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

import {
  extractAttachmentText,
  buildAttachmentTextBlock,
  isTextExtractableMime,
  ZIP_MIME,
  DOCX_MIME,
  MARKDOWN_MIME,
  PLAIN_TEXT_MIME,
  MAX_TEXT_PER_FILE,
} from './extractAttachmentText';
import type { ChatAttachment } from './buildAttachmentBlocks';

vi.mock(
  '../../infrastracture/adapters/fileConversion/convertDocxToHTML',
  () => ({
    convertDocxToHTML: vi.fn(),
  })
);

import { convertDocxToHTML } from '../../infrastracture/adapters/fileConversion/convertDocxToHTML';

const mockedConvertDocx = convertDocxToHTML as MockedFunction<
  typeof convertDocxToHTML
>;

function notionZip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, contents] of Object.entries(files)) {
    entries[name] = strToU8(contents);
  }
  return Buffer.from(zipSync(entries));
}

describe('isTextExtractableMime', () => {
  it.each([ZIP_MIME, DOCX_MIME, MARKDOWN_MIME, PLAIN_TEXT_MIME])(
    'returns true for %s',
    (mime) => {
      expect(isTextExtractableMime(mime)).toBe(true);
    }
  );

  it.each(['application/pdf', 'image/png', 'image/jpeg'])(
    'returns false for %s',
    (mime) => {
      expect(isTextExtractableMime(mime)).toBe(false);
    }
  );
});

describe('extractAttachmentText', () => {
  beforeEach(() => {
    mockedConvertDocx.mockReset();
  });

  it('reads markdown attachments as UTF-8', async () => {
    const attachment: ChatAttachment = {
      mimeType: MARKDOWN_MIME,
      data: Buffer.from('# Title\n\nSome **markdown** body.', 'utf8'),
      fileName: 'notes.md',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result).toEqual([
      { fileName: 'notes.md', text: '# Title\n\nSome **markdown** body.' },
    ]);
  });

  it('reads plain text attachments as UTF-8', async () => {
    const attachment: ChatAttachment = {
      mimeType: PLAIN_TEXT_MIME,
      data: Buffer.from('plain notes here', 'utf8'),
      fileName: 'scratch.txt',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result).toEqual([
      { fileName: 'scratch.txt', text: 'plain notes here' },
    ]);
  });

  it('extracts text from a Notion .zip export, stripping HTML tags', async () => {
    const attachment: ChatAttachment = {
      mimeType: ZIP_MIME,
      data: notionZip({
        'Page abc.html':
          '<html><body><h1>Mitochondria</h1><p>Powerhouse of the cell.</p></body></html>',
      }),
      fileName: 'export.zip',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe('export.zip');
    expect(result[0].text).toContain('Mitochondria');
    expect(result[0].text).toContain('Powerhouse of the cell.');
    expect(result[0].text).not.toContain('<h1>');
  });

  it('ignores hidden and __MACOSX entries in a zip', async () => {
    const attachment: ChatAttachment = {
      mimeType: ZIP_MIME,
      data: notionZip({
        '__MACOSX/._Page.html': '<html><body>junk</body></html>',
        'Real.html': '<html><body><p>Real content</p></body></html>',
      }),
      fileName: 'export.zip',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result[0].text).toContain('Real content');
    expect(result[0].text).not.toContain('junk');
  });

  it('does not extract a zip entry whose name escapes via ..', async () => {
    const attachment: ChatAttachment = {
      mimeType: ZIP_MIME,
      data: notionZip({
        '../escape.html': '<html><body><p>escaped</p></body></html>',
        'safe.html': '<html><body><p>safe content</p></body></html>',
      }),
      fileName: 'export.zip',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result[0].text).toContain('safe content');
    expect(result[0].text).not.toContain('escaped');
  });

  it('extracts text from a .docx via the conversion adapter', async () => {
    mockedConvertDocx.mockResolvedValue(
      '<h2>Heading</h2><p>Docx body text</p>'
    );
    const attachment: ChatAttachment = {
      mimeType: DOCX_MIME,
      data: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      fileName: 'essay.docx',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result[0].fileName).toBe('essay.docx');
    expect(result[0].text).toContain('Heading');
    expect(result[0].text).toContain('Docx body text');
  });

  it('skips image and pdf attachments', async () => {
    const attachments: ChatAttachment[] = [
      {
        mimeType: 'image/png',
        data: Buffer.from([0x89, 0x50]),
        fileName: 'a.png',
      },
      {
        mimeType: 'application/pdf',
        data: Buffer.from([0x25, 0x50]),
        fileName: 'b.pdf',
      },
    ];

    const result = await extractAttachmentText(attachments);

    expect(result).toEqual([]);
  });

  it('truncates a single file over the per-file cap with a marker', async () => {
    const big = 'x'.repeat(MAX_TEXT_PER_FILE + 5_000);
    const attachment: ChatAttachment = {
      mimeType: PLAIN_TEXT_MIME,
      data: Buffer.from(big, 'utf8'),
      fileName: 'big.txt',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result[0].text.length).toBeLessThanOrEqual(MAX_TEXT_PER_FILE + 20);
    expect(result[0].text).toContain('truncated');
  });

  it('drops empty extractions', async () => {
    const attachment: ChatAttachment = {
      mimeType: PLAIN_TEXT_MIME,
      data: Buffer.from('   \n  ', 'utf8'),
      fileName: 'blank.txt',
    };

    const result = await extractAttachmentText([attachment]);

    expect(result).toEqual([]);
  });
});

describe('buildAttachmentTextBlock', () => {
  it('wraps each file in a named file block', () => {
    const block = buildAttachmentTextBlock([
      { fileName: 'a.md', text: 'first' },
      { fileName: 'b.txt', text: 'second' },
    ]);

    expect(block).toContain('<file name="a.md">\nfirst\n</file>');
    expect(block).toContain('<file name="b.txt">\nsecond\n</file>');
  });

  it('returns empty string for no extracted files', () => {
    expect(buildAttachmentTextBlock([])).toBe('');
  });
});
