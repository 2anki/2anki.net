import { vi, type Mock } from 'vitest';
import { GetDatabasePreviewUseCase } from './GetDatabasePreviewUseCase';

interface QueryRow {
  id: string;
  properties: Record<string, unknown>;
}

interface FakeAPI {
  getDatabase: Mock;
  getDatabaseTitle: Mock;
  queryDatabasePreview: Mock;
}

function fakeApi(overrides: Partial<FakeAPI> = {}): FakeAPI {
  return {
    getDatabase: vi
      .fn()
      .mockResolvedValue({ object: 'database', url: 'https://notion.so/abc' }),
    getDatabaseTitle: vi.fn().mockResolvedValue('Vocabulary'),
    queryDatabasePreview: vi.fn().mockResolvedValue({
      results: [] as QueryRow[],
      hasMore: false,
    }),
    ...overrides,
  };
}

function titleProp(text: string) {
  return { type: 'title', title: [{ plain_text: text }] };
}

function richTextProp(text: string) {
  return { type: 'rich_text', rich_text: [{ plain_text: text }] };
}

describe('GetDatabasePreviewUseCase', () => {
  it('returns clean mapping when columns infer cleanly', async () => {
    const api = fakeApi({
      queryDatabasePreview: vi.fn().mockResolvedValue({
        results: [
          {
            id: 'row-1',
            properties: {
              Word: titleProp('Osmosis'),
              Definition: richTextProp('Movement of water'),
              Tags: { type: 'multi_select', multi_select: [{ name: 'Bio' }] },
            },
          },
          {
            id: 'row-2',
            properties: {
              Word: titleProp('Mitosis'),
              Definition: richTextProp('Cell division'),
              Tags: { type: 'multi_select', multi_select: [{ name: 'Bio' }] },
            },
          },
        ],
        hasMore: true,
      }),
    });

    const useCase = new GetDatabasePreviewUseCase(api as never);
    const result = await useCase.execute('abc', 'owner-1');

    expect(api.queryDatabasePreview).toHaveBeenCalledWith('abc', 10);
    expect(result.title).toBe('Vocabulary');
    expect(result.url).toBe('https://notion.so/abc');
    expect(result.columns).toEqual(['Word', 'Definition', 'Tags']);
    expect(result.mapping).toEqual({
      frontField: 'Word',
      backField: 'Definition',
      ambiguous: false,
    });
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]).toEqual({
      id: 'row-1',
      values: {
        Word: 'Osmosis',
        Definition: 'Movement of water',
        Tags: 'Bio',
      },
    });
    expect(result.rowCount).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it('flags ambiguous mapping when no candidate columns match', async () => {
    const api = fakeApi({
      queryDatabasePreview: vi.fn().mockResolvedValue({
        results: [
          {
            id: 'row-1',
            properties: {
              Name: titleProp('Anything'),
              Notes: richTextProp('Anything else'),
            },
          },
        ],
        hasMore: false,
      }),
    });

    const useCase = new GetDatabasePreviewUseCase(api as never);
    const result = await useCase.execute('abc', 'owner-1');

    expect(result.mapping.ambiguous).toBe(true);
    expect(result.columns).toEqual(['Name', 'Notes']);
    expect(result.hasMore).toBe(false);
  });

  it('returns empty preview when the database has no rows', async () => {
    const api = fakeApi({
      queryDatabasePreview: vi.fn().mockResolvedValue({
        results: [],
        hasMore: false,
      }),
    });

    const useCase = new GetDatabasePreviewUseCase(api as never);
    const result = await useCase.execute('abc', 'owner-1');

    expect(result.columns).toEqual([]);
    expect(result.samples).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.mapping).toEqual({
      frontField: null,
      backField: null,
      ambiguous: true,
    });
  });

  it('truncates samples to the preview cap and reports hasMore', async () => {
    const rows: QueryRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: `row-${i}`,
      properties: {
        Word: titleProp(`Term ${i}`),
        Definition: richTextProp(`Def ${i}`),
      },
    }));
    const api = fakeApi({
      queryDatabasePreview: vi.fn().mockResolvedValue({
        results: rows,
        hasMore: true,
      }),
    });

    const useCase = new GetDatabasePreviewUseCase(api as never);
    const result = await useCase.execute('abc', 'owner-1');

    expect(result.rowCount).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.samples).toHaveLength(10);
    expect(result.samples[0].id).toBe('row-0');
  });
});
