import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const mockSendMessage = jest.fn();
const mockRegenerate = jest.fn();
const mockTagCards = jest.fn();
const mockDeckGenerate = jest.fn();
const mockConversationsList = jest.fn();
const mockConversationsDeleteAll = jest.fn();

jest.mock('../data_layer', () => ({
  getDatabase: jest.fn().mockReturnValue({}),
}));

jest.mock('../lib/claude/ClaudeService', () => ({
  getAnthropicClient: jest.fn().mockReturnValue({}),
}));

jest.mock('../lib/storage/StorageHandler', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../controllers/ChatController', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    sendMessage: (req: express.Request, res: express.Response) => {
      mockSendMessage();
      res.status(200).end();
    },
    regenerateMessage: (req: express.Request, res: express.Response) => {
      mockRegenerate();
      res.status(200).end();
    },
  })),
}));

jest.mock('../controllers/TagCardsController', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    tag: (req: express.Request, res: express.Response) => {
      mockTagCards();
      res.status(200).json({ tags: [] });
    },
  })),
}));

jest.mock('../controllers/ChatDeckController', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    generate: (req: express.Request, res: express.Response) => {
      mockDeckGenerate();
      res.status(200).end();
    },
  })),
}));

jest.mock('../controllers/ConversationsController', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    list: (req: express.Request, res: express.Response) => {
      mockConversationsList();
      res.status(200).json([]);
    },
    deleteAll: (req: express.Request, res: express.Response) => {
      mockConversationsDeleteAll();
      res.status(204).end();
    },
    get: (req: express.Request, res: express.Response) =>
      res.status(200).json({}),
    rename: (req: express.Request, res: express.Response) =>
      res.status(204).end(),
    delete: (req: express.Request, res: express.Response) =>
      res.status(204).end(),
    saveDraft: (req: express.Request, res: express.Response) =>
      res.status(204).end(),
    saveTemplate: (req: express.Request, res: express.Response) =>
      res.status(204).end(),
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

import ChatRouter from './ChatRouter';

describe('ChatRouter paid gate', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use(ChatRouter());
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

  it.each([
    ['/api/chat/message'],
    ['/api/chat/conversations/7/regenerate'],
    ['/api/chat/tag-cards'],
  ])('returns 402 for a free user on %s', async (path) => {
    const response = await post(path);
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: 'upgrade required' });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockRegenerate).not.toHaveBeenCalled();
    expect(mockTagCards).not.toHaveBeenCalled();
  });

  it('lets a subscriber send a message', async () => {
    mockLocals = { owner: 42, patreon: false, subscriber: true };
    const response = await post('/api/chat/message', { content: 'hi' });
    expect(response.status).toBe(200);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('lets a lifetime user regenerate', async () => {
    mockLocals = { owner: 42, patreon: true, subscriber: false };
    const response = await post('/api/chat/conversations/7/regenerate');
    expect(response.status).toBe(200);
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
  });

  it('lets a free user build a deck from existing cards', async () => {
    const response = await post('/api/chat/deck', {
      deckName: 'd',
      cards: [{ front: 'f', back: 'b' }],
    });
    expect(response.status).toBe(200);
    expect(mockDeckGenerate).toHaveBeenCalledTimes(1);
  });

  it('lets a free user list conversations', async () => {
    const response = await fetch(`${baseUrl}/api/chat/conversations`);
    expect(response.status).toBe(200);
    expect(mockConversationsList).toHaveBeenCalledTimes(1);
  });

  it('lets a free user delete all conversations', async () => {
    const response = await fetch(`${baseUrl}/api/chat/conversations`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(204);
    expect(mockConversationsDeleteAll).toHaveBeenCalledTimes(1);
  });

  it('no longer serves the monthly usage endpoint', async () => {
    const response = await fetch(`${baseUrl}/api/chat/usage`);
    expect(response.status).toBe(404);
  });
});
