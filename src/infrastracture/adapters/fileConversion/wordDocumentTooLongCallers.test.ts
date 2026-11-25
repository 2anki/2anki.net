import { vi, type Mock } from 'vitest';

vi.mock('./wordDocumentTooLong', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wordDocumentTooLong')>();
  return {
    ...actual,
    refuseWordDocumentTooLong: vi.fn(actual.refuseWordDocumentTooLong),
  };
});

vi.mock('./convertDocxToHTML', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./convertDocxToHTML')>();
  return { convertDocxToHTML: vi.fn(actual.convertDocxToHTML) };
});

import { refuseWordDocumentTooLong } from './wordDocumentTooLong';
import { convertDocxToHTML } from './convertDocxToHTML';
import { censusFromHtml, censusUploadedFile } from './documentStructureCensus';
import { prepareDeckInfoOnly } from './PrepareDeck';
import {
  DOCX_MIME,
  extractAttachmentText,
} from '../../../usecases/chat/extractAttachmentText';
import CardOption from '../../../lib/parser/Settings';
import Workspace from '../../../lib/parser/WorkSpace';
import { setupTests } from '../../../test/configure-jest';
import {
  buildDocx,
  docxParagraph,
  docxRun,
} from '../../../test/fakes/buildDocx';
import {
  STUDY_NOTES_FAN_OUT_HTML,
  STUDY_NOTES_HTML,
  studyNotes,
} from '../../../test/fakes/studyNotesDocx';

const refuse = refuseWordDocumentTooLong as unknown as Mock;
const convert = convertDocxToHTML as unknown as Mock;

const notes = buildDocx({
  body: [
    docxParagraph(docxRun('Kidney'), { style: 'Heading1' }),
    docxParagraph(docxRun('The nephron filters blood.')),
  ].join(''),
});

// The upload census and chat attachments run in the web process and only
// read text; the length check belongs to the conversion worker alone.
describe('callers of the Word converter', () => {
  beforeEach(() => {
    setupTests();
    refuse.mockClear();
    convert.mockClear();
  });

  it('censuses an uploaded Word file without the length check', async () => {
    const census = await censusUploadedFile({
      originalname: 'notes.docx',
      buffer: notes,
    });

    expect(census).toEqual(censusFromHtml(await convertDocxToHTML(notes)));
    expect(refuse).not.toHaveBeenCalled();
  });

  it('reads a Word chat attachment without the length check', async () => {
    const [extracted] = await extractAttachmentText([
      { mimeType: DOCX_MIME, data: notes, fileName: 'notes.docx' },
    ]);

    expect(extracted.text).toContain('The nephron filters blood.');
    expect(refuse).not.toHaveBeenCalled();
  });

  it('runs the length check on the conversion worker path', async () => {
    await prepareDeckInfoOnly(
      {
        name: 'notes.docx',
        settings: new CardOption(CardOption.LoadDefaultOptions()),
        files: [{ name: 'notes.docx', contents: notes }],
        noLimits: false,
        workspace: new Workspace(true, 'fs'),
      },
      new Workspace(true, 'fs'),
      new Workspace(true, 'fs')
    );

    expect(refuse).toHaveBeenCalledWith(notes);
  });

  it('converts short study notes on the worker path, check and all, to the HTML captured from main', async () => {
    const settings = new CardOption(CardOption.LoadDefaultOptions());
    const docx = studyNotes();

    await prepareDeckInfoOnly(
      {
        name: 'notes.docx',
        settings,
        files: [{ name: 'notes.docx', contents: docx }],
        noLimits: false,
        workspace: new Workspace(true, 'fs'),
      },
      new Workspace(true, 'fs'),
      new Workspace(true, 'fs')
    );

    expect(refuse).toHaveBeenCalledWith(docx);
    const html = (await convert.mock.results[0].value) as string;
    expect(html.replace(/src="[^"]+\.png"/, 'src="figure.png"')).toBe(
      settings.overlappingCloze === 'off'
        ? STUDY_NOTES_FAN_OUT_HTML
        : STUDY_NOTES_HTML
    );
  });
});
