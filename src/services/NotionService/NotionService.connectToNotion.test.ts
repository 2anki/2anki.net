import { NotionService } from './NotionService';
import { __resetTopLevelPagesCacheForTests } from './topLevelPagesCache';
import { __resetTopLevelPagesRefreshGateForTests } from './topLevelPagesRefreshGate';

const OWNER = 1;

const topLevelPage = (id: string, title: string) => ({
  id,
  object: 'page' as const,
  url: `https://notion.so/${id}`,
  icon: null,
  title,
  parent: { type: 'workspace' },
});

type StoredRow = {
  owner: number;
  notion_page_id: string;
  title: string;
  icon: unknown;
  url: string | null;
  parent_type: string;
  last_edited_time: Date | null;
  cached_at: Date;
};

function makeService() {
  let grantedPages = [topLevelPage('before', 'Granted before')];
  let storedRows: StoredRow[] = [];

  const api = {
    searchTopLevelPages: jest.fn(async () => ({ results: grantedPages })),
  };
  const topLevelPagesRepository = {
    getByOwner: jest.fn(async () => storedRows),
    newestCachedAt: jest.fn(async () =>
      storedRows.length === 0
        ? null
        : new Date(Math.max(...storedRows.map((r) => r.cached_at.getTime())))
    ),
    replaceForOwnerIfTokenStillValid: jest.fn(
      async (_owner: number, next: StoredRow[]) => {
        storedRows = next;
        return true;
      }
    ),
    deleteByOwner: jest.fn(async () => {
      const removed = storedRows.length;
      storedRows = [];
      return removed;
    }),
  };
  const notionRepository = {
    getNotionData: jest.fn(),
    saveNotionToken: jest.fn().mockResolvedValue(true),
    getNotionToken: jest.fn(),
    deleteBlocksByOwner: jest.fn(),
    deleteNotionData: jest.fn(),
    markTokenInvalid: jest.fn().mockResolvedValue(undefined),
    clearTokenInvalid: jest.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: jest.fn().mockResolvedValue(true),
  };

  const service = new NotionService(
    notionRepository as never,
    topLevelPagesRepository as never
  );
  service.getAccessData = jest.fn().mockResolvedValue({
    access_token: 'token',
    workspace_name: 'Workspace',
  }) as never;
  service.tryGetNotionAPI = jest.fn(async () => api as never) as never;
  service.getNotionAPI = jest.fn(async () => api as never) as never;

  return {
    service,
    notionRepository,
    topLevelPagesRepository,
    grantPages: (pages: ReturnType<typeof topLevelPage>[]) => {
      grantedPages = pages;
    },
  };
}

const flushPreWarm = () => new Promise((resolve) => setImmediate(resolve));

describe('NotionService.connectToNotion', () => {
  beforeEach(() => {
    __resetTopLevelPagesCacheForTests();
    __resetTopLevelPagesRefreshGateForTests();
  });

  it('shows pages granted at reconnect on the very next picker read', async () => {
    const { service, grantPages } = makeService();
    const beforeReconnect = await service.searchTopLevelPages('', OWNER);
    expect(beforeReconnect.results.map((r) => r.id)).toEqual(['before']);

    grantPages([
      topLevelPage('before', 'Granted before'),
      topLevelPage('after', 'Granted at reconnect'),
    ]);
    await service.connectToNotion('auth-code', OWNER);
    const afterReconnect = await service.searchTopLevelPages('', OWNER);
    await flushPreWarm();

    expect(afterReconnect.results.map((r) => r.id)).toEqual([
      'before',
      'after',
    ]);
  });

  it('still saves the token when clearing the cached page list fails', async () => {
    const { service, notionRepository, topLevelPagesRepository } =
      makeService();
    topLevelPagesRepository.deleteByOwner.mockRejectedValueOnce(
      new Error('db unavailable')
    );
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      service.connectToNotion('auth-code', OWNER)
    ).resolves.toBeUndefined();
    await flushPreWarm();

    expect(notionRepository.saveNotionToken).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
