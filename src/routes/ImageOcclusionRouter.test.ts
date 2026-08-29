import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const mockExecute = jest.fn();

jest.mock('../data_layer', () => ({
  getDatabase: jest.fn().mockReturnValue({}),
}));

jest.mock('../lib/storage/StorageHandler', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../data_layer/IoDraftRepository', () => ({
  IoDraftRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../data_layer/NotionRespository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../data_layer/EventsRepository', () => ({
  EventsRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../usecases/imageOcclusion/PhotoToFlashcardsUseCase', () => ({
  PhotoToFlashcardsUseCase: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../usecases/imageOcclusion/CreateImageOcclusionDeckUseCase', () => ({
  CreateImageOcclusionDeckUseCase: jest.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

let mockLocals: {
  owner: number | null;
  patreon: boolean;
  subscriber: boolean;
} = { owner: 42, patreon: false, subscriber: false };

// The real middleware reads the session cookie and the subscriptions table;
// here it only has to do what it does on every other route in this router:
// put the resolved paying state onto res.locals before the handler runs.
jest.mock('./middleware/RequireAuthentication', () => {
  const attach = (res: express.Response) => {
    res.locals.owner = mockLocals.owner ?? undefined;
    res.locals.patreon = mockLocals.patreon;
    res.locals.subscriber = mockLocals.subscriber;
  };
  const OptionalAuthentication = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    attach(res);
    next();
  };
  const RequireAuthentication = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (mockLocals.owner == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    attach(res);
    next();
  };
  return {
    __esModule: true,
    default: RequireAuthentication,
    OptionalAuthentication,
  };
});

import ImageOcclusionRouter from './ImageOcclusionRouter';

describe('ImageOcclusionRouter — POST /api/image-occlusion paying gate', () => {
  let server: http.Server;
  let baseUrl: string;
  let apkgPath: string;

  beforeAll((done) => {
    const app = express();
    app.use(ImageOcclusionRouter());
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocals = { owner: 42, patreon: false, subscriber: false };
    apkgPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'io-router-')),
      'deck.apkg'
    );
    fs.writeFileSync(apkgPath, 'apkg');
    mockExecute.mockResolvedValue(apkgPath);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(apkgPath), { recursive: true, force: true });
  });

  const postDeck = (imageCount: number) => {
    const form = new FormData();
    form.append(
      'data',
      JSON.stringify({
        deckName: 'Anatomy',
        mode: 'hide_all',
        images: Array.from({ length: imageCount }, (_, index) => ({
          imageName: `page-${index + 1}.png`,
          header: '',
          rects: [{ x: 0, y: 0, w: 10, h: 10 }],
          s3Key: `drafts/page-${index + 1}.png`,
        })),
      })
    );
    return fetch(`${baseUrl}/api/image-occlusion`, {
      method: 'POST',
      body: form,
    });
  };

  it('hands the subscriber flag from the session to the use case', async () => {
    mockLocals = { owner: 42, patreon: false, subscriber: true };

    const response = await postDeck(4);

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ isPaying: true })
    );
  });

  it('hands the lifetime flag from the session to the use case', async () => {
    mockLocals = { owner: 42, patreon: true, subscriber: false };

    const response = await postDeck(4);

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ isPaying: true })
    );
  });

  it('keeps the download open to a guest, who stays on the free tier', async () => {
    mockLocals = { owner: null, patreon: false, subscriber: false };

    const response = await postDeck(2);

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ isPaying: false })
    );
  });
});
