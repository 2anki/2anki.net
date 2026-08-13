import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockDelete = jest.fn();
const mockExport = jest.fn();
const mockGetById = jest.fn();
const mockUpdate = jest.fn();
const mockCount = jest.fn();
const mockGetUserActiveSubscriptions = jest.fn();

const mockUploadFile = jest.fn().mockResolvedValue(undefined);
const mockGetPresignedUrl = jest
  .fn()
  .mockResolvedValue('https://spaces.example.com/presigned');
const mockObjectExists = jest.fn().mockResolvedValue(false);
const mockListByPrefix = jest.fn().mockResolvedValue([]);
const mockDeleteObjects = jest.fn().mockResolvedValue(undefined);

jest.mock('../lib/storage/StorageHandler', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    uploadFile: mockUploadFile,
    getPresignedUrl: mockGetPresignedUrl,
    objectExists: mockObjectExists,
    listByPrefix: mockListByPrefix,
    deleteObjects: mockDeleteObjects,
    getFileContents: jest.fn().mockResolvedValue({ Body: undefined }),
    delete: jest.fn(),
    getContents: jest.fn(),
    uniqify: jest.fn(),
  })),
}));

jest.mock('../data_layer', () => ({
  getDatabase: jest.fn().mockReturnValue({}),
}));

jest.mock('../data_layer/MindmapRepository', () => ({
  MindmapRepository: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    findById: mockGetById,
    findByUserId: mockList,
    update: mockUpdate,
    delete: mockDelete,
    countByUserId: mockCount,
  })),
}));

jest.mock('../services/SubscriptionService', () => ({
  __esModule: true,
  default: {
    getUserActiveSubscriptions: (...args: unknown[]) =>
      mockGetUserActiveSubscriptions(...args),
  },
}));

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
    res.locals.email = 'tester@example.com';
    res.locals.patreon = null;
    next();
  };
  return middleware;
});

process.env.SKIP_CREATE_DECK = '1';

async function buildServer() {
  const { default: MindmapRouter } = await import('./MindmapRouter');
  const app = express();
  app.use(express.json());
  app.use(MindmapRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('MindmapRouter', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthOwner = 42;
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockGetPresignedUrl.mockResolvedValue(
      'https://spaces.example.com/presigned'
    );
    mockObjectExists.mockResolvedValue(false);
    mockListByPrefix.mockResolvedValue([]);
  });

  describe('POST /api/mindmaps', () => {
    it('creates a map and returns 201', async () => {
      const map = {
        id: 'uuid-1',
        user_id: 42,
        title: 'My map',
        data: { nodes: [], edges: [] },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockCreate.mockResolvedValue(map);
      mockCount.mockResolvedValue(0);

      const res = await fetch(`${url}/api/mindmaps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'My map' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('uuid-1');
    });

    it('returns 402 when free user is at cap', async () => {
      mockCount.mockResolvedValue(3);

      const res = await fetch(`${url}/api/mindmaps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Overflow' }),
      });

      expect(res.status).toBe(402);
    });
  });

  describe('GET /api/mindmaps', () => {
    it('returns list with access block', async () => {
      const maps = [
        {
          id: 'a',
          user_id: 42,
          title: 'Map A',
          data: { nodes: [], edges: [] },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      mockList.mockResolvedValue(maps);
      mockCount.mockResolvedValue(1);

      const res = await fetch(`${url}/api/mindmaps`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.maps).toHaveLength(1);
      expect(body.access).toMatchObject({
        freeMapLimit: 3,
        maxNodesPerMap: 50,
        currentCount: 1,
      });
    });

    it('reports hasUnlimited when the user has an active Auto Sync subscription', async () => {
      const previousProductId = process.env.AUTO_SYNC_PRODUCT_ID;
      process.env.AUTO_SYNC_PRODUCT_ID = 'prod_auto_sync_test';
      mockList.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);
      mockGetUserActiveSubscriptions.mockResolvedValue([
        { active: true, stripe_product_id: 'prod_auto_sync_test' },
      ]);

      try {
        const res = await fetch(`${url}/api/mindmaps`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.access.hasUnlimited).toBe(true);
        expect(mockGetUserActiveSubscriptions).toHaveBeenCalledWith(
          'tester@example.com'
        );
      } finally {
        process.env.AUTO_SYNC_PRODUCT_ID = previousProductId;
      }
    });
  });

  describe('DELETE /api/mindmaps/:id', () => {
    it('deletes and returns 204', async () => {
      mockDelete.mockResolvedValue(undefined);

      const res = await fetch(`${url}/api/mindmaps/uuid-1`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(204);
      expect(mockDelete).toHaveBeenCalledWith('uuid-1', 42);
    });
  });

  describe('POST /api/mindmaps/:id/export', () => {
    const baseMap = {
      id: 'export-id',
      user_id: 42,
      title: 'Test deck',
      data: {
        nodes: [
          { id: '1', label: 'Parent' },
          { id: '2', label: 'Child' },
        ],
        edges: [{ source: '1', target: '2' }],
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('returns application/octet-stream', async () => {
      mockGetById.mockResolvedValue(baseMap);

      const res = await fetch(`${url}/api/mindmaps/export-id/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_name: 'Test deck' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(
        'application/octet-stream'
      );
    });

    it('defaults to basic card type when card_type is omitted', async () => {
      mockGetById.mockResolvedValue(baseMap);

      const res = await fetch(`${url}/api/mindmaps/export-id/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_name: 'Test deck' }),
      });

      expect(res.status).toBe(200);
    });

    it('accepts card_type basic and returns a deck', async () => {
      mockGetById.mockResolvedValue(baseMap);

      const res = await fetch(`${url}/api/mindmaps/export-id/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_name: 'Test deck', card_type: 'basic' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(
        'application/octet-stream'
      );
    });

    it('accepts card_type markmap and returns a deck', async () => {
      mockGetById.mockResolvedValue(baseMap);

      const res = await fetch(`${url}/api/mindmaps/export-id/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_name: 'Test deck', card_type: 'markmap' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(
        'application/octet-stream'
      );
    });

    it('treats unknown card_type as basic', async () => {
      mockGetById.mockResolvedValue(baseMap);

      const res = await fetch(`${url}/api/mindmaps/export-id/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_name: 'Test deck', card_type: 'unknown' }),
      });

      expect(res.status).toBe(200);
    });

    it('reports zero excluded nodes for a fully connected map', async () => {
      mockGetById.mockResolvedValue(baseMap);

      const res = await fetch(`${url}/api/mindmaps/export-id/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_name: 'Test deck', card_type: 'basic' }),
      });

      expect(res.headers.get('x-excluded-node-count')).toBe('0');
    });

    it('reports isolated nodes as excluded in the basic export header', async () => {
      mockGetById.mockResolvedValue({
        ...baseMap,
        data: {
          nodes: [
            { id: '1', label: 'Parent' },
            { id: '2', label: 'Child' },
            { id: '3', label: 'Orphan' },
          ],
          edges: [{ source: '1', target: '2' }],
        },
      });

      const res = await fetch(`${url}/api/mindmaps/export-id/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_name: 'Test deck', card_type: 'basic' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('x-excluded-node-count')).toBe('1');
    });
  });

  describe('POST /api/mindmaps/:id/images', () => {
    const TINY_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    it('returns 201 with url, width, height for a valid PNG', async () => {
      const form = new FormData();
      form.append(
        'image',
        new Blob([TINY_PNG], { type: 'image/png' }),
        'test.png'
      );

      const res = await fetch(`${url}/api/mindmaps/map-1/images`, {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.url).toBe('https://spaces.example.com/presigned');
      expect(typeof body.width).toBe('number');
      expect(typeof body.height).toBe('number');
      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^mindmaps\/42\/map-1\/.+\.png$/),
        TINY_PNG
      );
    });

    it('returns 400 when no file is provided', async () => {
      const res = await fetch(`${url}/api/mindmaps/map-1/images`, {
        method: 'POST',
        body: new FormData(),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/mindmaps/images/:userId/:mapId/:file', () => {
    it('returns 302 redirect when object exists in Spaces', async () => {
      mockObjectExists.mockResolvedValue(true);
      mockGetPresignedUrl.mockResolvedValue(
        'https://spaces.example.com/presigned-img'
      );

      const res = await fetch(`${url}/api/mindmaps/images/42/map-1/img.png`, {
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        'https://spaces.example.com/presigned-img'
      );
    });

    it('returns 410 when object does not exist', async () => {
      mockObjectExists.mockResolvedValue(false);

      const res = await fetch(
        `${url}/api/mindmaps/images/42/map-1/missing.png`
      );

      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.code).toBe('image_missing');
    });

    it('returns 401 when not authenticated', async () => {
      mockAuthOwner = null;

      const res = await fetch(`${url}/api/mindmaps/images/42/map-1/img.png`);

      expect(res.status).toBe(401);
    });

    it('returns 403 cross-tenant: authenticated as user 42 but requesting user 99 image', async () => {
      mockObjectExists.mockResolvedValue(true);
      mockGetPresignedUrl.mockResolvedValue(
        'https://spaces.example.com/presigned-img'
      );

      const res = await fetch(`${url}/api/mindmaps/images/99/map-1/img.png`, {
        redirect: 'manual',
      });

      expect(res.status).toBe(403);
      expect(mockObjectExists).not.toHaveBeenCalled();
      expect(mockGetPresignedUrl).not.toHaveBeenCalled();
    });
  });
});
