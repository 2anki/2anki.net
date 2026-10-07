import { vi } from 'vitest';
import { GetRecentSourcesUseCase } from './GetRecentSourcesUseCase';
import type {
  INotionTopLevelPagesRepository,
  NotionTopLevelPageRow,
} from '../../data_layer/NotionTopLevelPagesRepository';
import type {
  IUploadRepository,
  LastReconvertibleUpload,
} from '../../data_layer/UploadRespository';

function notionPage(
  overrides: Partial<NotionTopLevelPageRow>
): NotionTopLevelPageRow {
  return {
    owner: 1,
    notion_page_id: 'page-1',
    title: 'A page',
    icon: null,
    url: null,
    parent_type: 'workspace',
    last_edited_time: new Date('2026-06-01T00:00:00.000Z'),
    cached_at: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildUseCase(
  pages: NotionTopLevelPageRow[],
  lastUpload: LastReconvertibleUpload | null
) {
  const recentByOwner = vi.fn().mockResolvedValue(pages);
  const notionRepo = {
    getByOwner: vi.fn(),
    getRecentByOwner: recentByOwner,
    newestCachedAt: vi.fn(),
    replaceForOwnerIfTokenStillValid: vi.fn(),
    deleteByOwner: vi.fn(),
  } as unknown as INotionTopLevelPagesRepository;

  const lastReconvertible = vi.fn().mockResolvedValue(lastUpload);
  const uploadRepo = {
    deleteUpload: vi.fn(),
    getUploadsByOwner: vi.fn(),
    findByIdAndOwner: vi.fn(),
    findByKey: vi.fn(),
    findAllByObjectIdAndOwner: vi.fn(),
    update: vi.fn(),
    getLastUploadForUser: vi.fn(),
    getLastReconvertibleUpload: lastReconvertible,
  } as unknown as IUploadRepository;

  return {
    useCase: new GetRecentSourcesUseCase(notionRepo, uploadRepo),
    recentByOwner,
    lastReconvertible,
  };
}

describe('GetRecentSourcesUseCase', () => {
  it('maps Notion pages to the DTO shape sorted by recency desc', async () => {
    const { useCase } = buildUseCase(
      [
        notionPage({
          notion_page_id: 'old',
          title: 'Old page',
          last_edited_time: new Date('2026-05-01T00:00:00.000Z'),
        }),
        notionPage({
          notion_page_id: 'new',
          title: 'New page',
          last_edited_time: new Date('2026-06-02T00:00:00.000Z'),
        }),
      ],
      null
    );

    const result = await useCase.execute(1);

    expect(result).toEqual([
      {
        id: 'new',
        title: 'New page',
        type: 'notion',
        updatedAt: '2026-06-02T00:00:00.000Z',
        convertUrl: '/preview/new',
      },
      {
        id: 'old',
        title: 'Old page',
        type: 'notion',
        updatedAt: '2026-05-01T00:00:00.000Z',
        convertUrl: '/preview/old',
      },
    ]);
  });

  it('includes the last reconvertible upload and sorts it by recency', async () => {
    const { useCase } = buildUseCase(
      [
        notionPage({
          notion_page_id: 'p',
          title: 'A page',
          last_edited_time: new Date('2026-05-01T00:00:00.000Z'),
        }),
      ],
      {
        key: 'user-1/Biochem.apkg',
        filename: 'Biochem.apkg',
        created_at: new Date('2026-06-02T00:00:00.000Z'),
      }
    );

    const result = await useCase.execute(1);

    expect(result[0]).toEqual({
      id: 'user-1/Biochem.apkg',
      title: 'Biochem.apkg',
      type: 'remote_upload',
      updatedAt: '2026-06-02T00:00:00.000Z',
      convertUrl: '/preview/apkg/user-1%2FBiochem.apkg',
    });
  });

  it('caps the result at 3 items', async () => {
    const { useCase } = buildUseCase(
      [
        notionPage({
          notion_page_id: 'a',
          last_edited_time: new Date('2026-06-04T00:00:00.000Z'),
        }),
        notionPage({
          notion_page_id: 'b',
          last_edited_time: new Date('2026-06-03T00:00:00.000Z'),
        }),
        notionPage({
          notion_page_id: 'c',
          last_edited_time: new Date('2026-06-02T00:00:00.000Z'),
        }),
      ],
      {
        key: 'k.apkg',
        filename: 'k.apkg',
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      }
    );

    const result = await useCase.execute(1);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array when there are no sources', async () => {
    const { useCase } = buildUseCase([], null);

    const result = await useCase.execute(1);

    expect(result).toEqual([]);
  });

  it('requests at most 3 Notion pages from the repository', async () => {
    const { useCase, recentByOwner } = buildUseCase([], null);

    await useCase.execute(42);

    expect(recentByOwner).toHaveBeenCalledWith(42, 3);
  });

  it('falls back to cached_at when last_edited_time is null', async () => {
    const { useCase } = buildUseCase(
      [
        notionPage({
          notion_page_id: 'p',
          last_edited_time: null,
          cached_at: new Date('2026-06-05T00:00:00.000Z'),
        }),
      ],
      null
    );

    const result = await useCase.execute(1);

    expect(result[0].updatedAt).toBe('2026-06-05T00:00:00.000Z');
  });
});
