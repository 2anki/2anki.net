import { vi, type Mocked } from 'vitest';
import type express from 'express';

vi.mock('../../../services/observability/instrumentedAxios');

vi.mock('../../../data_layer', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../data_layer/GoogleDriveRepository', () => ({
  GoogleDriveRepository: vi.fn().mockImplementation(function () {
    return {
      saveFiles: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('../../../lib/User/getOwner', () => ({
  getOwner: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../lib/isPaying', () => ({
  isPaying: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../lib/integrations/stripe', () => ({
  getStripe: vi.fn().mockReturnValue({
    customers: { retrieve: vi.fn() },
  }),
  updateStoreSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/SubscriptionService', () => ({
  __esModule: true,
  default: { findActiveStripeSubscriptions: vi.fn() },
}));

vi.mock('../../../services/EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../data_layer/UsersRepository');
vi.mock('../../../services/UsersService');

import instrumentedAxios from '../../../services/observability/instrumentedAxios';
import { handleGoogleDrive } from './handleGoogleDrive';

const mockedAxios = instrumentedAxios as Mocked<typeof instrumentedAxios>;

function makeReq(
  files: object[],
  googleDriveAuth: string | undefined = 'valid-token'
): express.Request {
  return {
    body: {
      files: JSON.stringify(files),
      googleDriveAuth,
    },
  } as unknown as express.Request;
}

interface FakeRes {
  statusCode: number;
  sentBody: string;
  status: (code: number) => FakeRes;
  send: (body: string) => FakeRes;
  locals: Record<string, unknown>;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    sentBody: '',
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    send(body: string) {
      res.sentBody = body;
      return res;
    },
    locals: {},
  };
  return res;
}

const basePdfFile = {
  id: 'pdf-file-id',
  name: 'lecture.pdf',
  mimeType: 'application/pdf',
  iconUrl: '',
  url: '',
  sizeBytes: 1024,
  embedUrl: '',
  description: '',
  driveSuccess: true,
  isShared: false,
  lastEditedUtc: 0,
  serviceId: '',
  type: 'document',
};

const baseDocFile = {
  ...basePdfFile,
  id: 'doc-file-id',
  name: 'lecture notes',
  mimeType: 'application/vnd.google-apps.document',
};

const baseSheetFile = {
  ...basePdfFile,
  id: 'sheet-file-id',
  name: 'vocab list',
  mimeType: 'application/vnd.google-apps.spreadsheet',
};

const baseSlidesFile = {
  ...basePdfFile,
  id: 'slides-file-id',
  name: 'bio lecture',
  mimeType: 'application/vnd.google-apps.presentation',
};

describe('handleGoogleDrive — native Google Apps mime types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from('fake content'),
    } as never);
  });

  it('uses alt=media download URL for binary files (PDF)', async () => {
    const req = makeReq([basePdfFile]);
    const res = makeRes();
    const handleUpload = vi.fn();
    await handleGoogleDrive(
      req,
      res as unknown as express.Response,
      handleUpload
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'google_drive',
      expect.stringContaining('?alt=media'),
      expect.anything()
    );
    expect(handleUpload).toHaveBeenCalled();
    const reqFiles = (req as unknown as { files: { originalname: string }[] })
      .files;
    expect(reqFiles[0].originalname).toBe('lecture.pdf');
  });

  it('uses export URL for Google Docs and sets .docx extension', async () => {
    const req = makeReq([baseDocFile]);
    const res = makeRes();
    const handleUpload = vi.fn();
    await handleGoogleDrive(
      req,
      res as unknown as express.Response,
      handleUpload
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'google_drive',
      expect.stringContaining(
        '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document'
      ),
      expect.anything()
    );
    const reqFiles = (req as unknown as { files: { originalname: string }[] })
      .files;
    expect(reqFiles[0].originalname).toMatch(/\.docx$/);
  });

  it('uses export URL for Google Sheets and sets .csv extension', async () => {
    const req = makeReq([baseSheetFile]);
    const res = makeRes();
    const handleUpload = vi.fn();
    await handleGoogleDrive(
      req,
      res as unknown as express.Response,
      handleUpload
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'google_drive',
      expect.stringContaining('/export?mimeType=text%2Fcsv'),
      expect.anything()
    );
    const reqFiles = (req as unknown as { files: { originalname: string }[] })
      .files;
    expect(reqFiles[0].originalname).toMatch(/\.csv$/);
  });

  it('uses export URL for Google Slides and sets .pptx extension', async () => {
    const req = makeReq([baseSlidesFile]);
    const res = makeRes();
    const handleUpload = vi.fn();
    await handleGoogleDrive(
      req,
      res as unknown as express.Response,
      handleUpload
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'google_drive',
      expect.stringContaining(
        '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.presentationml.presentation'
      ),
      expect.anything()
    );
    const reqFiles = (req as unknown as { files: { originalname: string }[] })
      .files;
    expect(reqFiles[0].originalname).toMatch(/\.pptx$/);
  });

  it('derives size from the downloaded buffer, not the picker-reported sizeBytes', async () => {
    const zeroSizeDoc = { ...baseDocFile, sizeBytes: 0 };
    const req = makeReq([zeroSizeDoc]);
    const res = makeRes();
    const handleUpload = vi.fn();
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from('<html><body><h1>hello</h1></body></html>'),
    } as never);
    await handleGoogleDrive(
      req,
      res as unknown as express.Response,
      handleUpload
    );
    const reqFiles = (
      req as unknown as {
        files: { size: number; buffer: Buffer }[];
      }
    ).files;
    expect(reqFiles[0].size).toBeGreaterThan(0);
    expect(Buffer.isBuffer(reqFiles[0].buffer)).toBe(true);
    expect(handleUpload).toHaveBeenCalled();
  });

  it('requests arraybuffer responseType so bodies are not coerced to strings', async () => {
    const req = makeReq([baseDocFile]);
    const res = makeRes();
    const handleUpload = vi.fn();
    await handleGoogleDrive(
      req,
      res as unknown as express.Response,
      handleUpload
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'google_drive',
      expect.any(String),
      expect.objectContaining({ responseType: 'arraybuffer' })
    );
  });

  it('returns 400 and does not call handleUpload when googleDriveAuth is missing', async () => {
    const req = makeReq([basePdfFile], undefined);
    (req.body as Record<string, unknown>).googleDriveAuth = undefined;
    const res = makeRes();
    const handleUpload = vi.fn();
    await handleGoogleDrive(
      req,
      res as unknown as express.Response,
      handleUpload
    );
    expect(res.statusCode).toBe(400);
    expect(handleUpload).not.toHaveBeenCalled();
  });
});
