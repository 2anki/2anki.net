import { vi, type Mock, type Mocked } from 'vitest';
import {
  ExportReviewDataToNotionUseCase,
  findTrackerPropertyKey,
  MissingTrackerSchemaError,
  NotionExportClient,
  NotionNotConnectedError,
  TrackerSchema,
} from './ExportReviewDataToNotionUseCase';
import { NoActiveAnkifyClientError } from './SendUploadToRacUseCase';
import { AnkifyClient } from '../../entities/ankify';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { INotionRepository } from '../../data_layer/NotionRespository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';

const sampleClient = (): AnkifyClient => ({
  id: 1,
  owner: 42,
  container_id: 'c',
  container_name: null,
  anki_port: 20000,
  vnc_port: 21000,
  novnc_port: 22000,
  anki_connect_api_key: null,
  status: 'active',
  created_at: new Date(),
  last_active_at: new Date(),
});

const makeClientsRepo = (
  override: { activeClient?: AnkifyClient | null } = {}
): Mocked<AnkifyClientsRepositoryInterface> =>
  ({
    create: vi.fn(),
    listByOwner: vi.fn(),
    findActiveById: vi.fn(),
    findActiveByOwner: vi.fn(async () =>
      'activeClient' in override ? override.activeClient! : sampleClient()
    ),
    setStatus: vi.fn(),
    touchLastActiveAt: vi.fn(),
    reservedPorts: vi.fn(),
    listIdleSince: vi.fn(),
  }) as unknown as Mocked<AnkifyClientsRepositoryInterface>;

const makeNotionRepo = (token: string | null): Mocked<INotionRepository> =>
  ({
    getNotionData: vi.fn(),
    saveNotionToken: vi.fn(),
    getNotionToken: vi.fn(async () => token),
    deleteBlocksByOwner: vi.fn(),
    deleteNotionData: vi.fn(),
    markTokenInvalid: vi.fn(async () => undefined),
    clearTokenInvalid: vi.fn(async () => undefined),
  }) as unknown as Mocked<INotionRepository>;

const makeAnkiConnect = (
  rows: Array<[string, number]>,
  minutesByDay: Map<string, number> = new Map()
) =>
  ({
    getNumCardsReviewedByDay: vi.fn(async () => rows),
    getReviewMinutesByDay: vi.fn(async () => minutesByDay),
  }) as unknown as AnkiConnectClient;

const defaultSchema = (): TrackerSchema => ({
  properties: {
    Date: { type: 'date' },
    Reviews: { type: 'number' },
  },
});

const makeNotionClient = (
  existingDates: string[] = [],
  schema: TrackerSchema = defaultSchema()
): {
  client: NotionExportClient;
  create: Mock;
  query: Mock;
  getSchema: Mock;
} => {
  const create = vi.fn(async () => ({}));
  const query = vi.fn(async (params: any) => ({
    results: existingDates.includes(params.filter.date.equals) ? [{}] : [],
  }));
  const getSchema = vi.fn(async () => schema);
  return {
    create,
    query,
    getSchema,
    client: {
      databases: { query },
      pages: { create },
      getSchema,
    } as NotionExportClient,
  };
};

describe('ExportReviewDataToNotionUseCase', () => {
  test('exports each day not yet present in the Notion database', async () => {
    const clients = makeClientsRepo();
    const notionRepo = makeNotionRepo('notion-token-xyz');
    const ac = makeAnkiConnect([
      ['2026-05-05', 12],
      ['2026-05-06', 7],
      ['2026-05-07', 0],
    ]);
    const { client: notion, create, query } = makeNotionClient(['2026-05-05']);

    const useCase = new ExportReviewDataToNotionUseCase(
      clients,
      notionRepo,
      () => ac,
      () => notion
    );

    const result = await useCase.execute({
      owner: 42,
      databaseId: 'db-id',
    });

    expect(result.totalDays).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.exported).toBe(2);
    expect(query).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith({
      parent: { database_id: 'db-id' },
      properties: {
        Date: { date: { start: '2026-05-06' } },
        Reviews: { number: 7 },
      },
    });
  });

  test('honors dateRangeDays by trimming the tail of the data', async () => {
    const clients = makeClientsRepo();
    const notionRepo = makeNotionRepo('notion-token');
    const ac = makeAnkiConnect([
      ['2026-05-01', 1],
      ['2026-05-02', 2],
      ['2026-05-03', 3],
      ['2026-05-04', 4],
    ]);
    const { client: notion, create } = makeNotionClient();

    const useCase = new ExportReviewDataToNotionUseCase(
      clients,
      notionRepo,
      () => ac,
      () => notion
    );

    const result = await useCase.execute({
      owner: 42,
      databaseId: 'db-id',
      dateRangeDays: 2,
    });

    expect(result.totalDays).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    const dates = (create as Mock).mock.calls.map(
      (c) => c[0].properties.Date.date.start
    );
    expect(dates).toEqual(['2026-05-03', '2026-05-04']);
  });

  test('throws NoActiveAnkifyClientError when the user has no provisioned client', async () => {
    const clients = makeClientsRepo({ activeClient: null });
    const useCase = new ExportReviewDataToNotionUseCase(
      clients,
      makeNotionRepo('t'),
      () => makeAnkiConnect([]),
      () => makeNotionClient().client
    );

    await expect(
      useCase.execute({ owner: 42, databaseId: 'db' })
    ).rejects.toBeInstanceOf(NoActiveAnkifyClientError);
  });

  test('throws NotionNotConnectedError when the user has no Notion token', async () => {
    const useCase = new ExportReviewDataToNotionUseCase(
      makeClientsRepo(),
      makeNotionRepo(null),
      () => makeAnkiConnect([]),
      () => makeNotionClient().client
    );

    await expect(
      useCase.execute({ owner: 42, databaseId: 'db' })
    ).rejects.toBeInstanceOf(NotionNotConnectedError);
  });

  test('throws MissingTrackerSchemaError when the schema has no Date or Reviews', async () => {
    const useCase = new ExportReviewDataToNotionUseCase(
      makeClientsRepo(),
      makeNotionRepo('t'),
      () => makeAnkiConnect([['2026-05-07', 5]]),
      () =>
        makeNotionClient([], { properties: { Title: { type: 'title' } } })
          .client
    );
    const promise = useCase.execute({ owner: 42, databaseId: 'db' });
    await expect(promise).rejects.toBeInstanceOf(MissingTrackerSchemaError);
    await expect(promise).rejects.toMatchObject({
      missing: ['Date', 'Reviews'],
    });
  });

  test('writes Time spent (minutes) when the tracker has the column', async () => {
    const clients = makeClientsRepo();
    const notionRepo = makeNotionRepo('notion-token');
    const ac = makeAnkiConnect(
      [
        ['2026-05-06', 12],
        ['2026-05-07', 7],
      ],
      new Map([
        ['2026-05-06', 24.4],
        ['2026-05-07', 8.7],
      ])
    );
    const schemaWithTimeSpent: TrackerSchema = {
      properties: {
        Date: { type: 'date' },
        Reviews: { type: 'number' },
        'Time spent': { type: 'number' },
      },
    };
    const { client: notion, create } = makeNotionClient(
      [],
      schemaWithTimeSpent
    );

    const useCase = new ExportReviewDataToNotionUseCase(
      clients,
      notionRepo,
      () => ac,
      () => notion
    );

    const result = await useCase.execute({ owner: 42, databaseId: 'db' });

    expect(result.exported).toBe(2);
    const calls = (create as Mock).mock.calls;
    expect(calls[0][0].properties).toMatchObject({
      Date: { date: { start: '2026-05-06' } },
      Reviews: { number: 12 },
      'Time spent': { number: 24 },
    });
    expect(calls[1][0].properties).toMatchObject({
      Date: { date: { start: '2026-05-07' } },
      Reviews: { number: 7 },
      'Time spent': { number: 9 },
    });
  });

  test('omits Time spent when the column is absent (legacy trackers stay supported)', async () => {
    const clients = makeClientsRepo();
    const notionRepo = makeNotionRepo('notion-token');
    const ac = makeAnkiConnect(
      [['2026-05-07', 3]],
      new Map([['2026-05-07', 12]])
    );
    const { client: notion, create } = makeNotionClient();

    const useCase = new ExportReviewDataToNotionUseCase(
      clients,
      notionRepo,
      () => ac,
      () => notion
    );

    await useCase.execute({ owner: 42, databaseId: 'db' });

    const properties = (create as Mock).mock.calls[0][0].properties;
    expect(properties).toHaveProperty('Date');
    expect(properties).toHaveProperty('Reviews');
    expect(properties).not.toHaveProperty('Time spent');
  });
});

describe('findTrackerPropertyKey', () => {
  test('matches case-insensitively against the property key', () => {
    const schema: TrackerSchema = {
      properties: { date: { type: 'date' }, Reviews: { type: 'number' } },
    };
    expect(findTrackerPropertyKey(schema, 'Date', 'date')).toBe('date');
    expect(findTrackerPropertyKey(schema, 'reviews', 'number')).toBe('Reviews');
  });

  test('falls back to the inner name field when keys differ from names', () => {
    const schema: TrackerSchema = {
      properties: { abc123: { type: 'date', name: 'Date' } },
    };
    expect(findTrackerPropertyKey(schema, 'Date', 'date')).toBe('abc123');
  });

  test('returns null when no property with the right type matches', () => {
    const schema: TrackerSchema = {
      properties: { Date: { type: 'rich_text' } },
    };
    expect(findTrackerPropertyKey(schema, 'Date', 'date')).toBeNull();
  });
});
