import { vi } from 'vitest';
import { NotionService } from './NotionService';
import { __resetTopLevelPagesCacheForTests } from './topLevelPagesCache';
import { __resetTopLevelPagesRefreshGateForTests } from './topLevelPagesRefreshGate';

const liveResults = [
  {
    id: 'p1',
    object: 'page' as const,
    url: 'https://notion.so/p1',
    icon: { type: 'emoji', emoji: '📓' },
    title: 'Top page 1',
    parent: { type: 'workspace' },
  },
  {
    id: 'p2',
    object: 'page' as const,
    url: 'https://notion.so/p2',
    icon: null,
    title: 'Top page 2',
    parent: { type: 'workspace' },
  },
];

function makeFakeApi() {
  const calls: string[] = [];
  const api = {
    searchTopLevelPages: vi.fn(async (query: string) => {
      calls.push(`live:${query}`);
      return { results: liveResults };
    }),
  };
  return { api, calls };
}

function makeFakeRepo(initial: { rows?: typeof rowsLike } = {}) {
  let rows: typeof rowsLike = initial.rows ?? [];
  const calls: string[] = [];
  return {
    calls,
    rows: () => rows,
    getByOwner: vi.fn(async () => {
      calls.push('getByOwner');
      return rows;
    }),
    newestCachedAt: vi.fn(async () => {
      calls.push('newestCachedAt');
      if (rows.length === 0) return null;
      return rows.map((r) => r.cached_at).reduce((a, b) => (a > b ? a : b));
    }),
    replaceForOwnerIfTokenStillValid: vi.fn(
      async (_owner: number, next: typeof rowsLike) => {
        calls.push('replace');
        rows = next;
        return true;
      }
    ),
    deleteByOwner: vi.fn(async () => {
      calls.push('delete');
      const before = rows.length;
      rows = [];
      return before;
    }),
  };
}

const rowsLike: Array<{
  owner: number;
  notion_page_id: string;
  title: string;
  icon: unknown;
  url: string | null;
  parent_type: string;
  last_edited_time: Date | null;
  cached_at: Date;
}> = [];

function makeService(opts: {
  api: ReturnType<typeof makeFakeApi>['api'] | null;
  repo: ReturnType<typeof makeFakeRepo>;
}) {
  const fakeNotionRepo = {
    getNotionData: vi.fn(),
    saveNotionToken: vi.fn(),
    getNotionToken: vi.fn(),
    deleteBlocksByOwner: vi.fn(),
    deleteNotionData: vi.fn(),
    markTokenInvalid: vi.fn().mockResolvedValue(undefined),
    clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: vi.fn().mockResolvedValue(true),
  };
  const service = new NotionService(
    fakeNotionRepo as never,
    opts.repo as never
  );
  service.tryGetNotionAPI = vi.fn(async () => opts.api as never) as never;
  service.getNotionAPI = vi.fn(async () => {
    if (opts.api == null) throw new Error('Unauthorized');
    return opts.api as never;
  }) as never;
  return service;
}

describe('NotionService.searchTopLevelPages two-tier read path', () => {
  beforeEach(() => {
    __resetTopLevelPagesCacheForTests();
    __resetTopLevelPagesRefreshGateForTests();
  });

  it('Tier 1 hit short-circuits Tier 2 and live', async () => {
    const fakeApi = makeFakeApi();
    const repo = makeFakeRepo();
    const service = makeService({ api: fakeApi.api, repo });

    await service.searchTopLevelPages('', 1);
    await service.searchTopLevelPages('', 1);

    expect(fakeApi.api.searchTopLevelPages).toHaveBeenCalledTimes(1);
    expect(repo.getByOwner).toHaveBeenCalledTimes(1);
  });

  it('Tier 2 hit (fresh) does not call live and does not refresh', async () => {
    const fakeApi = makeFakeApi();
    const fresh = new Date();
    const repo = makeFakeRepo({
      rows: [
        {
          owner: 1,
          notion_page_id: 'p1',
          title: 'Top page 1',
          icon: null,
          url: 'https://notion.so/p1',
          parent_type: 'workspace',
          last_edited_time: null,
          cached_at: fresh,
        },
      ],
    });
    const service = makeService({ api: fakeApi.api, repo });

    const result = await service.searchTopLevelPages('', 1);

    expect(result.results.map((r) => r.id)).toEqual(['p1']);
    expect(fakeApi.api.searchTopLevelPages).not.toHaveBeenCalled();
    expect(repo.replaceForOwnerIfTokenStillValid).not.toHaveBeenCalled();
  });

  it('stale Tier 2 returns immediately and fires a background refresh', async () => {
    const fakeApi = makeFakeApi();
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const repo = makeFakeRepo({
      rows: [
        {
          owner: 1,
          notion_page_id: 'old',
          title: 'Old',
          icon: null,
          url: null,
          parent_type: 'workspace',
          last_edited_time: null,
          cached_at: stale,
        },
      ],
    });
    const service = makeService({ api: fakeApi.api, repo });

    const result = await service.searchTopLevelPages('', 1);
    expect(result.results.map((r) => r.id)).toEqual(['old']);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(fakeApi.api.searchTopLevelPages).toHaveBeenCalledTimes(1);
    expect(repo.replaceForOwnerIfTokenStillValid).toHaveBeenCalledTimes(1);
  });

  it('5 simultaneous stale reads trigger exactly one background refresh', async () => {
    const fakeApi = makeFakeApi();
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const repo = makeFakeRepo({
      rows: [
        {
          owner: 1,
          notion_page_id: 'old',
          title: 'Old',
          icon: null,
          url: null,
          parent_type: 'workspace',
          last_edited_time: null,
          cached_at: stale,
        },
      ],
    });
    const service = makeService({ api: fakeApi.api, repo });

    await Promise.all(
      Array.from({ length: 5 }, () => service.searchTopLevelPages('', 1))
    );

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(fakeApi.api.searchTopLevelPages).toHaveBeenCalledTimes(1);
  });

  it('typed query bypasses Tier 2 entirely', async () => {
    const fakeApi = makeFakeApi();
    const repo = makeFakeRepo();
    const service = makeService({ api: fakeApi.api, repo });

    await service.searchTopLevelPages('foo', 1);

    expect(fakeApi.api.searchTopLevelPages).toHaveBeenCalledTimes(1);
    expect(fakeApi.api.searchTopLevelPages).toHaveBeenCalledWith('foo', {});
    expect(repo.getByOwner).not.toHaveBeenCalled();
    expect(repo.replaceForOwnerIfTokenStillValid).not.toHaveBeenCalled();
  });

  it('cold Tier 2 (no rows) falls through to live and persists results', async () => {
    const fakeApi = makeFakeApi();
    const repo = makeFakeRepo();
    const service = makeService({ api: fakeApi.api, repo });

    const result = await service.searchTopLevelPages('', 1);

    expect(result.results.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(fakeApi.api.searchTopLevelPages).toHaveBeenCalledTimes(1);
    expect(repo.replaceForOwnerIfTokenStillValid).toHaveBeenCalledTimes(1);
  });
});
