import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

let mockAuthOwner: number | null = 42;
let mockOriginOwner: number | undefined;

vi.mock('./middleware/RequireAuthentication', () => {
  const middleware = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (mockAuthOwner == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    res.locals.owner = mockAuthOwner;
    next();
  };
  return {
    __esModule: true,
    default: middleware,
    OptionalAuthentication: middleware,
  };
});

vi.mock('./middleware/RequireAllowedOrigin', () => ({
  __esModule: true,
  default: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (mockOriginOwner != null) res.locals.owner = mockOriginOwner;
    next();
  },
}));

vi.mock('../data_layer', () => ({
  __esModule: true,
  getDatabase: () => ({}),
}));

vi.mock('../lib/storage/StorageHandler', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

const mockDropbox = vi.fn();
const mockSample = vi.fn();
const mockFile = vi.fn();
const mockRetryPdf = vi.fn();

vi.mock('../controllers/Upload/UploadController', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      dropbox: mockDropbox,
      file: mockFile,
      retryPdfWithCredential: mockRetryPdf,
      googleDrive: vi.fn(),
      getDropboxUploads: vi.fn(),
      deleteDropboxUpload: vi.fn(),
      getGoogleDriveUploads: vi.fn(),
      deleteGoogleDriveUpload: vi.fn(),
    };
  }),
}));

vi.mock('../controllers/Upload/SaveNativeDeckController', () => ({
  SaveNativeDeckController: vi.fn().mockImplementation(function () {
    return {
      save: vi.fn(),
    };
  }),
}));

const mockGetJobReport = vi.fn();

vi.mock('../controllers/JobController', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      getJobs: vi.fn(),
      deleteJob: vi.fn(),
      getJobReport: mockGetJobReport,
    };
  }),
}));

vi.mock('../controllers/Upload/RecentSourcesController', () => ({
  RecentSourcesController: vi.fn().mockImplementation(function () {
    return {
      getRecentSources: vi.fn(),
    };
  }),
}));

vi.mock('../controllers/Upload/SampleUploadController', () => ({
  SampleUploadController: vi.fn().mockImplementation(function () {
    return {
      sample: mockSample,
    };
  }),
}));

vi.mock('../usecases/uploads/ConvertSampleDeckUseCase', () => ({
  ConvertSampleDeckUseCase: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

const mockClaimRecovery = vi.fn();

vi.mock('../controllers/Upload/ClaimRecoveryDeckController', () => ({
  ClaimRecoveryDeckController: vi.fn().mockImplementation(function () {
    return {
      claim: mockClaimRecovery,
    };
  }),
}));

import UploadRouter from './UploadRouter';
import ErrorHandler from './middleware/ErrorHandler';

const startServer = async () => {
  const app = express();
  app.use(UploadRouter());
  // The error middleware server.ts mounts after every router.
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (err) {
        void ErrorHandler(res, req, err);
        return;
      }
      next();
    }
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const postDropbox = (url: string) =>
  fetch(`${url}/api/upload/dropbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [
        {
          link: 'https://uc8.dl.dropboxusercontent.com/x',
          name: 'a.zip',
          bytes: 1,
        },
      ],
    }),
  });

describe('UploadRouter POST /api/upload/dropbox', () => {
  beforeEach(() => {
    mockAuthOwner = 42;
    mockDropbox.mockReset();
    mockDropbox.mockImplementation(
      (_req: express.Request, res: express.Response) => {
        res.status(200).json({ ok: true });
      }
    );
  });

  it('rejects unauthenticated dropbox uploads with 401', async () => {
    mockAuthOwner = null;
    const { url, close } = await startServer();
    try {
      const res = await postDropbox(url);
      expect(res.status).toBe(401);
      expect(mockDropbox).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('forwards an authenticated dropbox upload to the controller', async () => {
    const { url, close } = await startServer();
    try {
      const res = await postDropbox(url);
      expect(res.status).toBe(200);
      expect(mockDropbox).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });
});

describe('UploadRouter POST /api/upload/sample', () => {
  beforeEach(() => {
    mockSample.mockReset();
    mockSample.mockImplementation(
      (_req: express.Request, res: express.Response) => {
        res
          .status(200)
          .set('Content-Type', 'application/apkg')
          .set('X-Card-Count', '8')
          .send(Buffer.from('APKG'));
      }
    );
  });

  it('converts the bundled sample without requiring authentication', async () => {
    mockAuthOwner = null;
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/upload/sample`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Card-Count')).toBe('8');
      expect(mockSample).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });
});

describe('UploadRouter POST /api/upload/claim/recovery', () => {
  beforeEach(() => {
    mockAuthOwner = 42;
    mockClaimRecovery.mockReset();
    mockClaimRecovery.mockImplementation(
      (_req: express.Request, res: express.Response) => {
        res.status(200).json({ downloadKey: 'k.apkg', deckName: 'd.apkg' });
      }
    );
  });

  it('rejects a signed-out claim with 401', async () => {
    mockAuthOwner = null;
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/upload/claim/recovery`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
      expect(mockClaimRecovery).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('forwards a signed-in claim to the controller', async () => {
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/upload/claim/recovery`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(mockClaimRecovery).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });
});

describe('UploadRouter GET /api/upload/jobs/:jobId/report', () => {
  beforeEach(() => {
    mockAuthOwner = 42;
    mockGetJobReport.mockReset();
    mockGetJobReport.mockImplementation(
      (_req: express.Request, res: express.Response) => {
        res.status(200).json({ summary: {}, entries: [] });
      }
    );
  });

  it('rejects unauthenticated report reads with 401', async () => {
    mockAuthOwner = null;
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/upload/jobs/job-1/report`);
      expect(res.status).toBe(401);
      expect(mockGetJobReport).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('forwards an authenticated report read to the controller', async () => {
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/upload/jobs/job-1/report`);
      expect(res.status).toBe(200);
      expect(mockGetJobReport).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });
});

describe('UploadRouter tells the page whose session ran an upload', () => {
  const answerWith =
    (status: number, body: unknown) =>
    (_req: express.Request, res: express.Response) => {
      res.status(status).json(body);
    };

  beforeEach(() => {
    mockOriginOwner = 42;
    mockFile.mockReset();
    mockRetryPdf.mockReset();
  });

  afterEach(() => {
    mockOriginOwner = undefined;
  });

  it.each([
    ['a background job', 202, { jobId: 'job-1' }],
    ['the PDF question', 409, { code: 'choose_pdf_mode', reason: 'no_text' }],
  ])('before /api/upload/file answers with %s', async (_kind, status, body) => {
    mockFile.mockImplementation(answerWith(status, body));
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/upload/file`, { method: 'POST' });
      expect(res.status).toBe(status);
      expect(res.headers.get('X-Upload-Owner')).toBe('42');
    } finally {
      await close();
    }
  });

  it('for a signed-out visitor on /api/upload/file', async () => {
    mockOriginOwner = undefined;
    mockFile.mockImplementation(answerWith(200, {}));
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/upload/file`, { method: 'POST' });
      expect(res.headers.get('X-Upload-Owner')).toBe('none');
    } finally {
      await close();
    }
  });

  it('even when /api/upload/retry-with-credential refuses the body before the controller, through the error handler', async () => {
    const { url, close } = await startServer();
    try {
      const form = new FormData();
      form.append(
        'not-the-file-field',
        new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        'a.pdf'
      );
      const res = await fetch(`${url}/api/upload/retry-with-credential`, {
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ code: 'unsupported_format' });
      expect(res.headers.get('X-Upload-Owner')).toBe('42');
      expect(mockRetryPdf).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
