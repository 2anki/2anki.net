import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const mockAiGenerate = jest.fn();
const mockAiModify = jest.fn();
const mockListDefaults = jest.fn();

jest.mock('../data_layer', () => ({
  getDatabase: jest.fn().mockReturnValue({}),
}));

jest.mock('../controllers/TemplatesController', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    aiGenerate: (req: express.Request, res: express.Response) => {
      mockAiGenerate();
      res.status(200).json({ starter: {}, reply: '' });
    },
    aiModify: (req: express.Request, res: express.Response) => {
      mockAiModify();
      res.status(200).json({ starter: {}, reply: '' });
    },
    listDefaultTemplates: (req: express.Request, res: express.Response) => {
      mockListDefaults();
      res.status(200).json([]);
    },
    listOfficialTemplates: (req: express.Request, res: express.Response) =>
      res.status(200).json([]),
    createTemplate: (req: express.Request, res: express.Response) =>
      res.status(200).end(),
    deleteTemplate: (req: express.Request, res: express.Response) =>
      res.status(200).end(),
    getUserData: (req: express.Request, res: express.Response) =>
      res.status(200).json({ templates: [], hiddenIds: [] }),
    saveUserData: (req: express.Request, res: express.Response) =>
      res.status(200).json({ ok: true }),
    exportTemplate: (req: express.Request, res: express.Response) =>
      res.status(200).end(),
  })),
}));

let mockLocals: {
  owner: number | null;
  patreon: boolean;
  subscriber: boolean;
} = { owner: 42, patreon: false, subscriber: false };

jest.mock('./middleware/RequireAuthentication', () => {
  const middleware = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (mockLocals.owner == null) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    res.locals.owner = mockLocals.owner;
    res.locals.patreon = mockLocals.patreon;
    res.locals.subscriber = mockLocals.subscriber;
    next();
  };
  return middleware;
});

import TemplatesRouter from './TemplatesRouter';

describe('TemplatesRouter AI paid gate', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use(TemplatesRouter());
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
  });

  const post = (path: string, body: unknown = {}) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each([['/api/templates/ai/generate'], ['/api/templates/ai/modify']])(
    'returns 402 for a free user on %s',
    async (path) => {
      const response = await post(path, { prompt: 'x' });
      expect(response.status).toBe(402);
      expect(await response.json()).toEqual({ error: 'upgrade required' });
      expect(mockAiGenerate).not.toHaveBeenCalled();
      expect(mockAiModify).not.toHaveBeenCalled();
    }
  );

  it('lets a subscriber generate a draft', async () => {
    mockLocals = { owner: 42, patreon: false, subscriber: true };
    const response = await post('/api/templates/ai/generate', {
      prompt: 'basic vocab',
    });
    expect(response.status).toBe(200);
    expect(mockAiGenerate).toHaveBeenCalledTimes(1);
  });

  it('lets a lifetime user ask for a modification', async () => {
    mockLocals = { owner: 42, patreon: true, subscriber: false };
    const response = await post('/api/templates/ai/modify', {
      starter: {},
      instruction: 'darker',
    });
    expect(response.status).toBe(200);
    expect(mockAiModify).toHaveBeenCalledTimes(1);
  });

  it('keeps the starter catalogs available to free users', async () => {
    const response = await fetch(`${baseUrl}/api/templates/defaults`);
    expect(response.status).toBe(200);
    expect(mockListDefaults).toHaveBeenCalledTimes(1);
  });
});
