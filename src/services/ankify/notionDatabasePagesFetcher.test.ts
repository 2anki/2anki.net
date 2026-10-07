import { vi } from 'vitest';
const retrieveMock = vi.fn();
const queryMock = vi.fn();

vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      databases: { retrieve: retrieveMock },
      dataSources: { query: queryMock },
    };
  }),
}));

import { notionDatabasePagesFetcherFactory } from './notionDatabasePagesFetcher';

describe('notionDatabasePagesFetcherFactory', () => {
  beforeEach(() => {
    retrieveMock.mockReset();
    queryMock.mockReset();
    retrieveMock.mockResolvedValue({ data_sources: [{ id: 'data-source-1' }] });
  });

  test('resolves the first data source and follows the cursor', async () => {
    queryMock
      .mockResolvedValueOnce({
        results: [{ id: 'page-1' }, { id: 'page-2' }],
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        results: [{ id: 'page-3' }],
        next_cursor: null,
      });

    const fetch = notionDatabasePagesFetcherFactory('token');
    const pages = await fetch('database-id');

    expect(retrieveMock).toHaveBeenCalledWith({ database_id: 'database-id' });
    expect(pages).toEqual([
      { id: 'page-1', title: null },
      { id: 'page-2', title: null },
      { id: 'page-3', title: null },
    ]);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][0]).toMatchObject({
      data_source_id: 'data-source-1',
    });
    expect(queryMock.mock.calls[1][0]).toMatchObject({
      start_cursor: 'cursor-1',
    });
  });

  test('queries pages in created-time order so cards keep the page order', async () => {
    queryMock.mockResolvedValueOnce({
      results: [{ id: 'page-1' }],
      next_cursor: null,
    });

    const fetch = notionDatabasePagesFetcherFactory('token');
    await fetch('database-id');

    expect(queryMock.mock.calls[0][0]).toMatchObject({
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    });
  });

  test('extracts the row title from the title property', async () => {
    queryMock.mockResolvedValueOnce({
      results: [
        {
          id: 'page-1',
          properties: {
            Tags: { type: 'multi_select' },
            Name: {
              type: 'title',
              title: [{ plain_text: 'Cell ' }, { plain_text: 'Biology' }],
            },
          },
        },
        {
          id: 'page-2',
          properties: {
            Name: { type: 'title', title: [] },
          },
        },
        { id: 'page-3' },
      ],
      next_cursor: null,
    });

    const fetch = notionDatabasePagesFetcherFactory('token');
    const pages = await fetch('database-id');

    expect(pages).toEqual([
      { id: 'page-1', title: 'Cell Biology' },
      { id: 'page-2', title: null },
      { id: 'page-3', title: null },
    ]);
  });

  test('returns no pages when the database has no data source', async () => {
    retrieveMock.mockResolvedValue({ data_sources: [] });

    const fetch = notionDatabasePagesFetcherFactory('token');
    const pages = await fetch('database-id');

    expect(pages).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  test('skips rows that lack a string id', async () => {
    queryMock.mockResolvedValueOnce({
      results: [{ id: 'page-1' }, { id: 42 }, {}],
      next_cursor: null,
    });

    const fetch = notionDatabasePagesFetcherFactory('token');
    const pages = await fetch('database-id');

    expect(pages).toEqual([{ id: 'page-1', title: null }]);
  });
});
