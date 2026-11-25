import { vi } from 'vitest';

vi.mock('./docxBodyChunks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./docxBodyChunks')>();
  return { ...actual, splitDocxBody: vi.fn(actual.splitDocxBody) };
});

import { splitDocxBody } from './docxBodyChunks';
import { convertDocxToHTML } from './convertDocxToHTML';
import { convertLongDocxToHTML } from './convertLongDocxToHTML';
import { censusFromHtml, censusUploadedFile } from './documentStructureCensus';
import {
  DOCX_MIME,
  extractAttachmentText,
} from '../../../usecases/chat/extractAttachmentText';
import {
  buildDocx,
  docxParagraph,
  docxRun,
} from '../../../test/fakes/buildDocx';

const split = splitDocxBody as unknown as ReturnType<typeof vi.fn>;

function longNotes(): Buffer {
  const body = Array.from({ length: 12_000 }, (_, i) =>
    docxParagraph(docxRun(`Point ${i} about the kidney and its nephrons.`))
  ).join('');
  return buildDocx({ body });
}

// The upload census and chat attachments run in the web process and only
// read text, so they keep the whole-file conversion and never split.
describe('web-process callers of the Word converter', () => {
  const docx = longNotes();

  beforeEach(() => {
    split.mockClear();
  });

  it('censuses an uploaded long Word file from the whole-file conversion', async () => {
    const census = await censusUploadedFile({
      originalname: 'notes.docx',
      buffer: docx,
    });

    expect(census).toEqual(censusFromHtml(await convertDocxToHTML(docx)));
    expect(split).not.toHaveBeenCalled();
  }, 60000);

  it('reads a long Word chat attachment from the whole-file conversion', async () => {
    const [extracted] = await extractAttachmentText([
      { mimeType: DOCX_MIME, data: docx, fileName: 'notes.docx' },
    ]);

    expect(extracted.text.startsWith('Point 0 about the kidney')).toBe(true);
    expect(split).not.toHaveBeenCalled();
  }, 60000);

  it('splits the same file on the conversion worker path', async () => {
    await convertLongDocxToHTML(docx, { write: () => 'figure.png' });

    expect(split).toHaveBeenCalledTimes(1);
    expect(split.mock.results[0].value?.count).toBeGreaterThan(1);
  }, 60000);
});
