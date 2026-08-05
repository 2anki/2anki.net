import { Request, Response } from 'express';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import ApkgController from './ApkgController';
import DownloadService from '../services/DownloadService';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import PdfRenderService from '../services/PdfRenderService';
import { NotionService } from '../services/NotionService/NotionService';
import JobRepository from '../data_layer/JobRepository';
import ImportApkgToNotionUseCase from '../usecases/apkg/ImportApkgToNotionUseCase';
import ExportApkgToPdfUseCase from '../usecases/apkg/ExportApkgToPdfUseCase';
import ExportApkgToCsvUseCase, {
  CardLimitExceededError as CsvCardLimitExceededError,
  EmptyDeckError as CsvEmptyDeckError,
} from '../usecases/apkg/ExportApkgToCsvUseCase';
import { track } from '../services/events/track';

jest.mock('../usecases/apkg/ImportApkgToNotionUseCase');
jest.mock('../usecases/apkg/ExportApkgToPdfUseCase');
jest.mock('../usecases/apkg/ExportApkgToCsvUseCase', () => {
  const actual = jest.requireActual('../usecases/apkg/ExportApkgToCsvUseCase');
  return {
    __esModule: true,
    default: jest.fn(),
    CardLimitExceededError: actual.CardLimitExceededError,
    EmptyDeckError: actual.EmptyDeckError,
    CSV_FREE_NOTE_LIMIT: actual.CSV_FREE_NOTE_LIMIT,
    CSV_ANONYMOUS_NOTE_LIMIT: actual.CSV_ANONYMOUS_NOTE_LIMIT,
  };
});
jest.mock('../services/events/track', () => ({ track: jest.fn() }));
jest.mock('../lib/storage/StorageHandler', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('fake')),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const trackMock = track as jest.Mock;

function makeRes(locals: Record<string, unknown> = {}): Partial<Response> {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    locals: { owner: 'user-1', ...locals },
  };
}

function makeReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    params: {},
    query: {},
    body: { parent_page_id: 'parent-page-1' },
    file: {
      originalname: 'deck.apkg',
      path: '/tmp/deck.apkg',
      fieldname: 'file',
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      size: 1024,
      destination: '/tmp',
      filename: 'deck.apkg',
      buffer: Buffer.from(''),
      stream: null as never,
    },
    ...overrides,
  };
}

function makeAPIResponseError(code: string, status: number): APIResponseError {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, {
    name: 'APIResponseError',
    message: `notion internal detail for ${code}`,
    code,
    status,
  });
  return err;
}

function makeController() {
  const downloadService = {
    getFileBody: jest.fn(),
    isMissingDownloadError: jest.fn().mockReturnValue(false),
  } as unknown as DownloadService;
  const previewService = {
    parse: jest.fn(),
    getMeta: jest.fn(),
    getCardsPage: jest.fn(),
    getMediaEntry: jest.fn(),
  } as unknown as ApkgPreviewService;
  const pdfRenderService = {} as PdfRenderService;
  const notionService = {
    getNotionAPI: jest.fn().mockResolvedValue({
      createPage: jest.fn().mockResolvedValue({ id: 'page-1' }),
      appendBlocks: jest.fn().mockResolvedValue({}),
      getPage: jest.fn().mockResolvedValue({ url: 'https://notion.so/p' }),
    }),
  } as unknown as NotionService;
  const jobRepository = {
    countJobsByType: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue(undefined),
    updateJobStatus: jest.fn().mockResolvedValue({}),
    findJobById: jest.fn(),
  } as unknown as JobRepository;

  return new ApkgController(
    downloadService,
    previewService,
    pdfRenderService,
    notionService,
    jobRepository
  );
}

jest.mock('../usecases/apkg/PackEditedApkgUseCase');
import PackEditedApkgUseCase from '../usecases/apkg/PackEditedApkgUseCase';

describe('ApkgController.downloadEdited', () => {
  let executeMock: jest.Mock;

  beforeEach(() => {
    executeMock = jest.fn().mockResolvedValue({
      buffer: Buffer.from('fake-apkg'),
      filename: 'deck-edited.apkg',
    });
    (PackEditedApkgUseCase as jest.Mock).mockImplementation(() => ({
      execute: executeMock,
    }));
  });

  it('returns 400 when key is not an .apkg', async () => {
    const controller = makeController();
    const req = makeReq({
      params: { key: 'notanapkg.zip' },
      body: { edits: [] },
    }) as Request;
    const res = makeRes() as Response;
    await controller.downloadEdited(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when edits is not an array', async () => {
    const controller = makeController();
    const req = makeReq({
      params: { key: 'deck.apkg' },
      body: { edits: 'invalid' },
    }) as Request;
    const res = makeRes() as Response;
    await controller.downloadEdited(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when upload not found', async () => {
    const controller = makeController();
    const ds = controller['downloadService'] as jest.Mocked<DownloadService>;
    ds.getFileBody.mockResolvedValue(null);
    const req = makeReq({
      params: { key: 'deck.apkg' },
      body: { edits: [] },
    }) as Request;
    const res = makeRes() as Response;
    await controller.downloadEdited(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('sends the .apkg buffer when edits are valid', async () => {
    const fakeBuffer = Buffer.from('fake-apkg');
    const controller = makeController();
    const ds = controller['downloadService'] as jest.Mocked<DownloadService>;
    ds.getFileBody.mockResolvedValue(fakeBuffer);
    const res = makeRes() as Response;
    (res as unknown as Record<string, jest.Mock>).setHeader = jest.fn();
    (res as unknown as Record<string, jest.Mock>).send = jest.fn();
    const req = makeReq({
      params: { key: 'deck.apkg' },
      body: { edits: [{ cardIndex: 0, deleted: true }] },
    }) as Request;
    await controller.downloadEdited(req, res);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ edits: [{ cardIndex: 0, deleted: true }] })
    );
    expect(
      (res as unknown as Record<string, jest.Mock>).send
    ).toHaveBeenCalledWith(Buffer.from('fake-apkg'));
  });
});

describe('ApkgController.importToNotion', () => {
  let executeMock: jest.Mock;

  beforeEach(() => {
    executeMock = jest.fn().mockResolvedValue(undefined);
    (ImportApkgToNotionUseCase as jest.Mock).mockImplementation(() => ({
      execute: executeMock,
    }));
  });

  it('allows a free user to start an import with maxNotes=1000', async () => {
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeRes({ patreon: false, subscriber: false }) as Response;

    await controller.importToNotion(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    const executeCall = executeMock.mock.calls[0];
    expect(executeCall[5]).toMatchObject({ isPaying: false, maxNotes: 1000 });
  });

  it('gives a paying user maxNotes=10000', async () => {
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeRes({ patreon: true, subscriber: false }) as Response;

    await controller.importToNotion(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    const executeCall = executeMock.mock.calls[0];
    expect(executeCall[5]).toMatchObject({ isPaying: true, maxNotes: 10000 });
  });

  it('gives a subscriber user maxNotes=10000', async () => {
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeRes({ patreon: false, subscriber: true }) as Response;

    await controller.importToNotion(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    const executeCall = executeMock.mock.calls[0];
    expect(executeCall[5]).toMatchObject({ isPaying: true, maxNotes: 10000 });
  });

  it('returns 400 when the user has no accessible Notion pages', async () => {
    const controller = makeController();
    const notionService = controller[
      'notionService'
    ] as jest.Mocked<NotionService>;
    (notionService.getNotionAPI as jest.Mock).mockResolvedValue({
      searchTopLevelPages: jest.fn().mockResolvedValue({ results: [] }),
      createPage: jest.fn(),
    });
    const req = makeReq({ body: {} }) as Request;
    const res = makeRes({ patreon: false, subscriber: false }) as Response;

    await controller.importToNotion(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message:
        'No Notion pages available. Share at least one page with 2anki to use quick import.',
    });
  });

  it('returns 401 notion_unauthorized when Notion rejects the search as Unauthorized', async () => {
    const controller = makeController();
    const notionService = controller[
      'notionService'
    ] as jest.Mocked<NotionService>;
    (notionService.getNotionAPI as jest.Mock).mockResolvedValue({
      searchTopLevelPages: jest
        .fn()
        .mockRejectedValue(
          makeAPIResponseError(APIErrorCode.Unauthorized, 401)
        ),
      createPage: jest.fn(),
    });
    const req = makeReq({ body: {} }) as Request;
    const res = makeRes({ patreon: false, subscriber: false }) as Response;
    (res.json as jest.Mock).mockReturnThis();
    (res as unknown as Record<string, jest.Mock>).send = jest.fn();

    await controller.importToNotion(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'notion_unauthorized' })
    );
  });

  it('returns 500 when an unexpected error occurs while starting the import', async () => {
    const controller = makeController();
    const notionService = controller[
      'notionService'
    ] as jest.Mocked<NotionService>;
    (notionService.getNotionAPI as jest.Mock).mockRejectedValue(
      new Error('boom')
    );
    const req = makeReq({ body: {} }) as Request;
    const res = makeRes({ patreon: false, subscriber: false }) as Response;

    await controller.importToNotion(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Import failed to start.',
    });
  });
});

describe('ApkgController.exportPdf — pdf_print_options_used event', () => {
  beforeEach(() => {
    trackMock.mockClear();
    (ExportApkgToPdfUseCase as jest.Mock).mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        pdf: Buffer.from('fake-pdf'),
        deckName: 'deck',
        cardCount: 1,
      }),
    }));
  });

  function makePdfRes(locals: Record<string, unknown> = {}): Response {
    const res = makeRes(locals) as Partial<Response> & {
      setHeader?: jest.Mock;
      send?: jest.Mock;
    };
    res.setHeader = jest.fn();
    res.send = jest.fn();
    return res as Response;
  }

  it('fires the event with all four booleans false when every option is default', async () => {
    const controller = makeController();
    const req = makeReq({ body: {} }) as Request;
    const res = makePdfRes({ owner: 42 });

    await controller.exportPdf(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('pdf_print_options_used', {
      userId: 42,
      props: {
        backgroundColor: false,
        paperSize: false,
        orientation: false,
        margins: false,
      },
    });
  });

  it('flags backgroundColor true when the user picks a non-default color', async () => {
    const controller = makeController();
    const req = makeReq({ body: { backgroundColor: '#ff0000' } }) as Request;
    const res = makePdfRes({ owner: 42 });

    await controller.exportPdf(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('pdf_print_options_used', {
      userId: 42,
      props: {
        backgroundColor: true,
        paperSize: false,
        orientation: false,
        margins: false,
      },
    });
  });

  it('flags paperSize true when the user picks a non-default size', async () => {
    const controller = makeController();
    const req = makeReq({ body: { paperSize: 'Letter' } }) as Request;
    const res = makePdfRes({ owner: 42 });

    await controller.exportPdf(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('pdf_print_options_used', {
      userId: 42,
      props: {
        backgroundColor: false,
        paperSize: true,
        orientation: false,
        margins: false,
      },
    });
  });

  it('flags orientation true when the user picks landscape', async () => {
    const controller = makeController();
    const req = makeReq({ body: { orientation: 'landscape' } }) as Request;
    const res = makePdfRes({ owner: 42 });

    await controller.exportPdf(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('pdf_print_options_used', {
      userId: 42,
      props: {
        backgroundColor: false,
        paperSize: false,
        orientation: true,
        margins: false,
      },
    });
  });

  it('flags margins true when the user picks a non-default margin', async () => {
    const controller = makeController();
    const req = makeReq({ body: { margins: 'wide' } }) as Request;
    const res = makePdfRes({ owner: 42 });

    await controller.exportPdf(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('pdf_print_options_used', {
      userId: 42,
      props: {
        backgroundColor: false,
        paperSize: false,
        orientation: false,
        margins: true,
      },
    });
  });

  it('falls back to null userId when res.locals.owner is missing', async () => {
    const controller = makeController();
    const req = makeReq({ body: {} }) as Request;
    const res = makePdfRes();

    await controller.exportPdf(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      'pdf_print_options_used',
      expect.objectContaining({ userId: null })
    );
  });

  it('does not fire when the request is rejected before parsePdfOptions succeeds', async () => {
    const controller = makeController();
    const req = makeReq({ body: { backgroundColor: 'not-a-hex' } }) as Request;
    const res = makePdfRes({ owner: 42 });

    await controller.exportPdf(req, res);

    expect(trackMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('ApkgController.exportCsv', () => {
  function makeCsvRes(locals: Record<string, unknown> = {}): Response {
    const res = makeRes(locals) as Partial<Response> & {
      setHeader?: jest.Mock;
      send?: jest.Mock;
    };
    res.setHeader = jest.fn();
    res.send = jest.fn();
    return res as Response;
  }

  let executeMock: jest.Mock;

  beforeEach(() => {
    executeMock = jest.fn().mockResolvedValue({
      csv: Buffer.from('Model,Front,Back,Tags\r\nBasic,Q,A,\r\n'),
      deckName: 'My deck',
      noteCount: 1,
    });
    (ExportApkgToCsvUseCase as unknown as jest.Mock).mockImplementation(() => ({
      execute: executeMock,
    }));
  });

  it('returns 400 when no file is uploaded', async () => {
    const controller = makeController();
    const req = makeReq({ file: undefined }) as Request;
    const res = makeCsvRes();
    await controller.exportCsv(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the file is not an .apkg by extension', async () => {
    const controller = makeController();
    const req = makeReq({
      file: {
        ...(makeReq().file as Express.Multer.File),
        originalname: 'notes.zip',
      },
    }) as Request;
    const res = makeCsvRes();
    await controller.exportCsv(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('sends CSV bytes with attachment headers on success', async () => {
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeCsvRes({ patreon: true });

    await controller.exportCsv(req, res);

    expect(executeMock).toHaveBeenCalledWith(expect.any(Buffer), null);
    const setHeader = (res as unknown as { setHeader: jest.Mock }).setHeader;
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8'
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment;')
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('deck.csv')
    );
    expect(setHeader).toHaveBeenCalledWith('X-Card-Count', '1');
    expect((res as unknown as { send: jest.Mock }).send).toHaveBeenCalledWith(
      expect.any(Buffer)
    );
  });

  it('passes isPaying=false through to the use case for free users', async () => {
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeCsvRes({ patreon: false, subscriber: false });

    await controller.exportCsv(req, res);

    expect(executeMock).toHaveBeenCalledWith(expect.any(Buffer), 100);
  });

  it('returns 400 when the deck has no notes', async () => {
    executeMock.mockRejectedValueOnce(new CsvEmptyDeckError());
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeCsvRes({ patreon: true });

    await controller.exportCsv(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 402 with note count when a free user exceeds the cap', async () => {
    executeMock.mockRejectedValueOnce(new CsvCardLimitExceededError(250, 100));
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeCsvRes();

    await controller.exportCsv(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ note_count: 250, note_limit: 100 })
    );
  });

  // makeRes defaults locals.owner to 'user-1', so an anonymous case only exists
  // if owner is explicitly cleared. Without the override these read as
  // signed-in and quietly assert the wrong tier.
  it('caps an anonymous caller at the anonymous note limit', async () => {
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeCsvRes({ owner: undefined });

    await controller.exportCsv(req, res);

    expect(executeMock).toHaveBeenCalledWith(expect.any(Buffer), 21);
  });

  it('tells an anonymous caller over the cap to make an account, not to pay', async () => {
    executeMock.mockRejectedValueOnce(new CsvCardLimitExceededError(340, 21));
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeCsvRes({ owner: undefined });

    await controller.exportCsv(req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toMatchObject({
      note_count: 340,
      note_limit: 21,
      requires_account: true,
    });
    expect(body.message).toContain('340');
    expect(body.message).not.toMatch(/upgrade/i);
  });

  it('does not tell a signed-in caller over the cap that they need an account', async () => {
    executeMock.mockRejectedValueOnce(new CsvCardLimitExceededError(250, 100));
    const controller = makeController();
    const req = makeReq() as Request;
    const res = makeCsvRes({ patreon: false, subscriber: false });

    await controller.exportCsv(req, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.requires_account).toBe(false);
  });
});
