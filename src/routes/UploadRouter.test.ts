import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

let mockAuthOwner: number | null = 42;

jest.mock('./middleware/RequireAuthentication', () => {
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

jest.mock('./middleware/RequireAllowedOrigin', () => ({
  __esModule: true,
  default: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));

jest.mock('../data_layer', () => ({
  __esModule: true,
  getDatabase: () => ({}),
}));

jest.mock('../lib/storage/StorageHandler', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

const mockDropbox = jest.fn();

jest.mock('../controllers/Upload/UploadController', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    dropbox: mockDropbox,
    googleDrive: jest.fn(),
    getDropboxUploads: jest.fn(),
    deleteDropboxUpload: jest.fn(),
    getGoogleDriveUploads: jest.fn(),
    deleteGoogleDriveUpload: jest.fn(),
  })),
}));

jest.mock('../controllers/Upload/SaveNativeDeckController', () => ({
  SaveNativeDeckController: jest.fn().mockImplementation(() => ({
    save: jest.fn(),
  })),
}));

const mockGetJobReport = jest.fn();

jest.mock('../controllers/JobController', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getJobs: jest.fn(),
    deleteJob: jest.fn(),
    getJobReport: mockGetJobReport,
  })),
}));

jest.mock('../controllers/Upload/RecentSourcesController', () => ({
  RecentSourcesController: jest.fn().mockImplementation(() => ({
    getRecentSources: jest.fn(),
  })),
}));

import UploadRouter from './UploadRouter';

const startServer = async () => {
  const app = express();
  app.use(UploadRouter());
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
