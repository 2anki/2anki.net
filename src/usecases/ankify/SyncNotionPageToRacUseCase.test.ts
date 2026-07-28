import {
  AnkifyClientOfflineSkip,
  ANKI_OFFLINE_SKIP_MESSAGE,
  isAnkifyClientOfflineSkip,
  SyncNotionPageResult,
  SyncNotionPageToRacUseCase,
} from './SyncNotionPageToRacUseCase';
import { NoActiveAnkifyClientError } from './SendUploadToRacUseCase';
import { AnkiConnectUnreachableError } from '../../services/ankify/AnkiConnectClient';
import { AnkifyClient, AnkifyNotionSubscription } from '../../entities/ankify';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySyncMappingsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncMappingsRepository';
import { AnkifySyncConflictsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncConflictsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkifySyncLogsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncLogsRepository';
import { INotionRepository } from '../../data_layer/NotionRespository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { WalkedNotionFlashcard } from '../../services/ankify/notionPageWalker';
import { hashCardContent } from '../../lib/ankify/hashCardContent';

jest.mock('../../services/ankify/notionPageWalker', () => ({
  walkNotionPageForFlashcards: jest.fn(),
  walkNotionDatabaseForFlashcards: jest.fn(),
}));

jest.mock('../../services/events/track', () => ({
  track: jest.fn(),
}));

jest.mock('axios');

jest.mock('node:dns', () => ({
  promises: { lookup: jest.fn() },
}));

import axios from 'axios';
import dns from 'node:dns';
import {
  walkNotionPageForFlashcards,
  walkNotionDatabaseForFlashcards,
} from '../../services/ankify/notionPageWalker';
import { track } from '../../services/events/track';

const mockAxiosGet = axios.get as jest.Mock;
const mockDnsLookup = dns.promises.lookup as jest.Mock;
const mockTrack = track as jest.Mock;

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

const sampleSubscription = (
  overrides: Partial<AnkifyNotionSubscription> = {}
): AnkifyNotionSubscription => ({
  id: 1,
  owner: 42,
  ankify_client_id: 1,
  notion_page_id: 'page-id',
  notion_page_title: null,
  notion_page_url: null,
  notion_page_icon: null,
  target_deck: null,
  enabled: true,
  last_polled_at: null,
  last_synced_at: null,
  last_error: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const sampleCard = (
  overrides: Partial<WalkedNotionFlashcard> = {}
): WalkedNotionFlashcard => ({
  notion_block_id: 'block-1',
  front: 'Front text',
  back: 'Back text',
  notion_last_edited_at: new Date(),
  media: [],
  ...overrides,
});

const makeClients = (): jest.Mocked<AnkifyClientsRepositoryInterface> =>
  ({
    create: jest.fn(),
    listByOwner: jest.fn(),
    findActiveById: jest.fn(),
    findActiveByOwner: jest.fn(async () => sampleClient()),
    setStatus: jest.fn(),
    touchLastActiveAt: jest.fn(),
    reservedPorts: jest.fn(),
    listIdleSince: jest.fn(),
  }) as unknown as jest.Mocked<AnkifyClientsRepositoryInterface>;

const makeMappings = (): jest.Mocked<AnkifySyncMappingsRepositoryInterface> =>
  ({
    findBySourceId: jest.fn(async () => null),
    upsert: jest.fn(),
    listByClient: jest.fn(),
    findByAnkiNoteId: jest.fn(),
    deleteByAnkiNoteId: jest.fn(),
  }) as unknown as jest.Mocked<AnkifySyncMappingsRepositoryInterface>;

const makeConflicts = (): jest.Mocked<AnkifySyncConflictsRepositoryInterface> =>
  ({
    hasPending: jest.fn(async () => false),
    recordOrFindPending: jest.fn(),
  }) as unknown as jest.Mocked<AnkifySyncConflictsRepositoryInterface>;

const makeSubscriptionsRepo = (
  upsertResult: AnkifyNotionSubscription = sampleSubscription()
): jest.Mocked<AnkifyNotionSubscriptionsRepositoryInterface> =>
  ({
    upsert: jest.fn(async () => upsertResult),
    listByOwner: jest.fn(),
    listEnabled: jest.fn(),
    findByPageId: jest.fn(),
    findByOwnerAndPageId: jest.fn(async () => upsertResult),
    findById: jest.fn(),
    setEnabled: jest.fn(),
    deleteById: jest.fn(),
    recordPoll: jest.fn(),
    recordObjectType: jest.fn(),
  }) as unknown as jest.Mocked<AnkifyNotionSubscriptionsRepositoryInterface>;

const expectSyncResult = (
  result: SyncNotionPageResult | AnkifyClientOfflineSkip
): SyncNotionPageResult => {
  if (isAnkifyClientOfflineSkip(result)) {
    throw new Error('expected a sync result, got an offline skip');
  }
  return result;
};

const makeLogs = (): jest.Mocked<AnkifySyncLogsRepositoryInterface> =>
  ({
    log: jest.fn(async () => undefined),
    listByOwner: jest.fn(),
  }) as unknown as jest.Mocked<AnkifySyncLogsRepositoryInterface>;

const makeNotionRepo = (
  token: string | null = 'notion-token'
): jest.Mocked<INotionRepository> =>
  ({
    getNotionData: jest.fn(),
    saveNotionToken: jest.fn(),
    getNotionToken: jest.fn(async () => token),
    deleteBlocksByOwner: jest.fn(),
    deleteNotionData: jest.fn(),
    markTokenInvalid: jest.fn(async () => undefined),
    clearTokenInvalid: jest.fn(async () => undefined),
  }) as unknown as jest.Mocked<INotionRepository>;

const makeAnkiConnectStub = () =>
  ({
    ping: jest.fn(async () => 6),
    createDeck: jest.fn(async () => 1),
    addNote: jest.fn(async () => 7),
    notesInfo: jest.fn(async () => []),
    changeDeck: jest.fn(async () => null),
    updateNoteFields: jest.fn(async () => null),
    sync: jest.fn(async () => null),
    modelNames: jest.fn(async () => [] as string[]),
    getMediaFilesNames: jest.fn(async () => [] as string[]),
    createModel: jest.fn(async (_p: unknown) => ({ id: 1 })),
    updateModelStyling: jest.fn(async () => null),
    updateModelTemplates: jest.fn(async () => null),
    storeMediaFile: jest.fn(async () => 'stored.png'),
    apiReflect: jest.fn(async () => [] as string[]),
    notesModTime: jest.fn(async () => [] as { noteId: number; mod: number }[]),
    multi: jest.fn(async () => [] as unknown[]),
  }) as unknown as AnkiConnectClient & { [k: string]: jest.Mock };

const makeRepos = () => ({
  clients: makeClients(),
  mappings: makeMappings(),
  conflicts: makeConflicts(),
  subscriptions: makeSubscriptionsRepo(),
  logs: makeLogs(),
  notionRepo: makeNotionRepo(),
});

describe('SyncNotionPageToRacUseCase', () => {
  const emptyWalkResult = () => ({
    cards: [] as WalkedNotionFlashcard[],
    diagnostic: { blocks_scanned: 0, blocks_matched: 0, pattern_hits: {} },
  });

  beforeEach(() => {
    (walkNotionPageForFlashcards as jest.Mock).mockReset();
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockReset();
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );
    mockTrack.mockClear();
  });

  test('falls back to a database walk when the subscribed id is a Notion database', async () => {
    const databaseNotPageError = Object.assign(
      new Error(
        'Provided ID 379cbac1 is a database, not a page. Use the retrieve database API instead.'
      ),
      { code: 'validation_error' }
    );
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
      databaseNotPageError
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 4,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const databasePages = jest.fn(async () => [
      { id: 'row-1' },
      { id: 'row-2' },
    ]);
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      undefined,
      () => databasePages
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'database-id',
        trigger: 'polling',
      })
    );

    expect(walkNotionDatabaseForFlashcards).toHaveBeenCalledWith(
      'database-id',
      expect.any(Function),
      databasePages
    );
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: { Front: 'Front text', Back: 'Back text' },
      })
    );
    expect(result.created).toBe(1);
    expect(repos.subscriptions.setEnabled).not.toHaveBeenCalled();
    expect(repos.subscriptions.recordPoll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ synced: true })
    );
  });

  test('names the deck after the database title and produces cards for a database added by link', async () => {
    const databaseNotPageError = Object.assign(
      new Error(
        'xyz is a database, not a page. Use the retrieve database API.'
      ),
      { code: 'validation_error' }
    );
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
      databaseNotPageError
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 6,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const databasePages = jest.fn(async () => [{ id: 'row-1' }]);
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      (_token: string) => async (_id: string) => ({
        title: 'Pharmacology',
        url: 'https://www.notion.so/db-1',
        icon: '🧪',
      }),
      undefined,
      undefined,
      undefined,
      () => databasePages
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'db-1',
        trigger: 'manual',
      })
    );

    expect(repos.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        notion_page_id: 'db-1',
        notion_page_title: 'Pharmacology',
      })
    );
    expect(walkNotionDatabaseForFlashcards).toHaveBeenCalledWith(
      'db-1',
      expect.any(Function),
      databasePages
    );
    expect(result.created).toBe(1);
    expect(mockTrack).not.toHaveBeenCalledWith(
      'ankify_zero_cards',
      expect.anything()
    );
  });

  test('walks the database child pages when the page walk finds no blocks of its own', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 8,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const databasePages = jest.fn(async () => [
      { id: 'row-1' },
      { id: 'row-2' },
    ]);
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      undefined,
      () => databasePages
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'database-id',
        trigger: 'polling',
      })
    );

    expect(walkNotionDatabaseForFlashcards).toHaveBeenCalledWith(
      'database-id',
      expect.any(Function),
      databasePages
    );
    expect(result.created).toBe(1);
    expect(mockTrack).not.toHaveBeenCalledWith(
      'ankify_zero_cards',
      expect.anything()
    );
  });

  test('records the database object type when the meta fetch resolves a null-typed id as a database', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 8,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({
        id: 5,
        notion_page_id: 'database-id',
        notion_object_type: null,
      })
    );
    const ac = makeAnkiConnectStub();
    const databasePages = jest.fn(async () => [{ id: 'row-1' }]);
    const metaFetch = jest.fn(
      async (_id: string, _knownObjectType?: 'page' | 'database' | null) => ({
        title: 'Pharmacology',
        url: 'https://www.notion.so/db-1',
        icon: '🧪',
        objectType: 'database' as const,
      })
    );
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      () => metaFetch,
      undefined,
      undefined,
      undefined,
      () => databasePages
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'database-id',
      knownObjectType: null,
      trigger: 'polling',
    });

    expect(metaFetch).toHaveBeenCalledWith('database-id', null);
    expect(repos.subscriptions.recordObjectType).toHaveBeenCalledWith(
      5,
      'database'
    );
  });

  test('skips the page-meta retrieve on the next tick once the database type is known', async () => {
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 8,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({
        id: 5,
        notion_page_id: 'database-id',
        notion_object_type: 'database',
      })
    );
    const ac = makeAnkiConnectStub();
    const databasePages = jest.fn(async () => [{ id: 'row-1' }]);
    const metaFetch = jest.fn(
      async (_id: string, _knownObjectType?: 'page' | 'database' | null) => ({
        title: 'Pharmacology',
        url: 'https://www.notion.so/db-1',
        icon: '🧪',
        objectType: 'database' as const,
      })
    );
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      () => metaFetch,
      undefined,
      undefined,
      undefined,
      () => databasePages
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'database-id',
      knownObjectType: 'database',
      trigger: 'polling',
    });

    expect(metaFetch).toHaveBeenCalledWith('database-id', 'database');
    expect(walkNotionPageForFlashcards).not.toHaveBeenCalled();
    expect(repos.subscriptions.recordObjectType).not.toHaveBeenCalled();
  });

  test('keeps the empty-page result when the database probe finds no child pages', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );

    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const databasePages = jest.fn(async () => {
      throw Object.assign(
        new Error('page-id is not a database. Use the retrieve a page API.'),
        { code: 'validation_error' }
      );
    });
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      undefined,
      () => databasePages
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      })
    );

    expect(result.created).toBe(0);
    expect(mockTrack).toHaveBeenCalledWith(
      'ankify_zero_cards',
      expect.anything()
    );
  });

  test('skips the database probe when a known page yields zero cards', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );

    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({ id: 7, notion_object_type: 'page' })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        knownObjectType: 'page',
        trigger: 'polling',
      })
    );

    expect(walkNotionDatabaseForFlashcards).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
  });

  test('records the page object type when the database probe reports the id is a page', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue(
      emptyWalkResult()
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockRejectedValue(
      Object.assign(
        new Error(
          'Provided database_id page-id is a page, not a database. Use the pages API instead, or pass the ID of the database itself.'
        ),
        { code: 'validation_error' }
      )
    );

    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({ id: 7, notion_object_type: null })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      })
    );

    expect(repos.subscriptions.recordObjectType).toHaveBeenCalledWith(
      7,
      'page'
    );
    expect(result.created).toBe(0);
  });

  test('propagates a non-database validation error without a database walk', async () => {
    const otherError = Object.assign(new Error('Something else broke'), {
      code: 'validation_error',
    });
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(otherError);

    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await expect(
      useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      })
    ).rejects.toThrow('Something else broke');
    expect(walkNotionDatabaseForFlashcards).not.toHaveBeenCalled();
  });

  test('persists icon returned by the page-meta fetcher on upsert', async () => {
    const clients = makeClients();
    const mappings = makeMappings();
    const conflicts = makeConflicts();
    const subscriptions = makeSubscriptionsRepo();
    const logs = makeLogs();
    const notionRepo = makeNotionRepo();
    const ac = makeAnkiConnectStub();

    const useCase = new SyncNotionPageToRacUseCase(
      clients,
      mappings,
      conflicts,
      subscriptions,
      logs,
      notionRepo,
      () => ac,
      () => async () => [],
      (_token: string) => async (_pageId: string) => ({
        title: 'Algebra',
        url: 'https://www.notion.so/algebra',
        icon: '📘',
      })
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        notion_page_id: 'page-id',
        notion_page_title: 'Algebra',
        notion_page_url: 'https://www.notion.so/algebra',
        notion_page_icon: '📘',
      })
    );
  });

  test('lazy-fills missing icon on subsequent sync when the meta fetcher returns one', async () => {
    const clients = makeClients();
    const mappings = makeMappings();
    const conflicts = makeConflicts();
    const subscriptions = makeSubscriptionsRepo(
      sampleSubscription({ notion_page_icon: null })
    );
    const logs = makeLogs();
    const notionRepo = makeNotionRepo();
    const ac = makeAnkiConnectStub();

    const useCase = new SyncNotionPageToRacUseCase(
      clients,
      mappings,
      conflicts,
      subscriptions,
      logs,
      notionRepo,
      () => ac,
      () => async () => [],
      () => async () => ({
        title: null,
        url: null,
        icon: 'https://example.com/icon.png',
      })
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'polling',
    });

    expect(subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        notion_page_icon: 'https://example.com/icon.png',
      })
    );
  });

  test('addNote uses the Ankify Basic model name', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'Ankify Basic',
        fields: { Front: 'Front text', Back: 'Back text' },
      })
    );
  });

  test('addNote uses the user’s custom basic model name when templateOverridesProvider returns an override', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      async () => ({
        basicModelName: 'ATTI BASIC',
        basicTemplate: {
          parent: 'Basic',
          name: 'ATTI BASIC',
          storageKey: 'n2a-basic',
          front: '{{Front}}',
          back: '{{Back}}',
          styling: '.card { color: tomato; }',
        },
      })
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'ATTI BASIC',
        fields: { Front: 'Front text', Back: 'Back text', MyMedia: '' },
      })
    );
    const createdNames = (ac.createModel as jest.Mock).mock.calls.map(
      (args) => (args[0] as { modelName: string }).modelName
    );
    expect(createdNames).toContain('ATTI BASIC');
    expect(createdNames).not.toContain('Ankify Basic');
  });

  test('resolves the template override for the synced page, not just the owner', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const templateOverridesProvider = jest.fn(async () => ({
      basicModelName: 'ATTI BASIC',
      basicTemplate: {
        parent: 'Basic',
        name: 'ATTI BASIC',
        storageKey: 'n2a-basic',
        front: '{{Front}}',
        back: '{{Back}}',
        styling: '.card { color: tomato; }',
      },
    }));
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      templateOverridesProvider
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'synced-page-id',
      trigger: 'polling',
    });

    expect(templateOverridesProvider).toHaveBeenCalledWith(
      42,
      'synced-page-id'
    );
  });

  test('seeds Ankify note types before the first addNote call', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const callOrder: string[] = [];
    (ac.createModel as jest.Mock).mockImplementation(async () => {
      callOrder.push('createModel');
      return { id: 1 };
    });
    (ac.addNote as jest.Mock).mockImplementation(async () => {
      callOrder.push('addNote');
      return 7_777_777;
    });

    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.modelNames).toHaveBeenCalled();
    const createdNames = (ac.createModel as jest.Mock).mock.calls.map(
      (args) => (args[0] as { modelName: string }).modelName
    );
    expect(createdNames).toEqual(
      expect.arrayContaining(['Ankify Basic', 'Ankify Cloze'])
    );
    expect(callOrder.indexOf('createModel')).toBeLessThan(
      callOrder.indexOf('addNote')
    );
  });

  test('addNote uses a per-page deck name nested under "Notion Sync"', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({ notion_page_title: 'Algebra Basics' })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      () => async () => ({
        title: 'Algebra Basics',
        url: null,
        icon: null,
      })
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.createDeck).toHaveBeenCalledWith('Notion Sync::Algebra Basics');
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        deckName: 'Notion Sync::Algebra Basics',
      })
    );
    expect(repos.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        deck_name: 'Notion Sync::Algebra Basics',
      })
    );
  });

  test('falls back to "Notion Sync::Untitled" when the page title is null', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({ notion_page_title: null })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.createDeck).toHaveBeenCalledWith('Notion Sync::Untitled');
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({ deckName: 'Notion Sync::Untitled' })
    );
  });

  test('strips "::" from titles so users cannot accidentally nest deeper', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({ notion_page_title: '  Quick::Tricks  ' })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.createDeck).toHaveBeenCalledWith('Notion Sync::QuickTricks');
  });

  test('builds the deck from target_deck when set, not the Notion Sync default', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({
        notion_page_title: 'Small Bowel Cancer',
        target_deck: 'MS3::General Surgery::Small Bowel, IBD::Cancer',
      })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.createDeck).toHaveBeenCalledWith(
      'MS3::General Surgery::Small Bowel, IBD::Cancer'
    );
    expect(ac.createDeck).not.toHaveBeenCalledWith(
      'Notion Sync::Small Bowel Cancer'
    );
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        deckName: 'MS3::General Surgery::Small Bowel, IBD::Cancer',
      })
    );
    expect(repos.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        deck_name: 'MS3::General Surgery::Small Bowel, IBD::Cancer',
      })
    );
  });

  test('moves already-mapped cards into the target deck and rewrites their mapping', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard({ notion_block_id: 'block-1' })],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({
        notion_page_title: 'Pharmacology',
        target_deck: 'MS3::Pharmacology',
      })
    );
    const existingMapping = {
      id: 5,
      ankify_client_id: 1,
      source_id: 'block-1',
      source_type: 'notion_block' as const,
      anki_note_id: 900,
      deck_name: 'Notion Sync::Pharmacology',
      content_hash: hashCardContent('Front text', 'Back text'),
      last_synced_at: new Date(2020, 0, 1),
    };
    repos.mappings.findBySourceId = jest.fn(
      async (_clientId: number, _sourceId: string) => existingMapping
    );
    const ac = makeAnkiConnectStub();
    (ac.notesInfo as jest.Mock).mockImplementation(async (notes: number[]) => {
      if (notes.includes(900)) {
        return [
          {
            noteId: 900,
            modelName: 'Ankify Basic',
            tags: [],
            fields: {
              Front: { value: 'Front text', order: 0 },
              Back: { value: 'Back text', order: 1 },
            },
            cards: [9001, 9002],
            mod: Math.floor(new Date(2020, 0, 1).getTime() / 1000),
          },
        ];
      }
      return [];
    });
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'polling',
    });

    expect(ac.changeDeck).toHaveBeenCalledWith(
      [9001, 9002],
      'MS3::Pharmacology'
    );
    expect(repos.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: 'block-1',
        anki_note_id: 900,
        deck_name: 'MS3::Pharmacology',
      })
    );
    expect(mockTrack).toHaveBeenCalledWith('ankify_sync_followed_deck', {
      userId: 42,
      props: expect.objectContaining({
        source_type: 'notion_page',
        moved_notes: 1,
        trigger: 'polling',
      }),
    });
  });

  test('puts each database child page into its own subdeck under the database deck', async () => {
    const databaseNotPageError = Object.assign(
      new Error('db-1 is a database, not a page.'),
      { code: 'validation_error' }
    );
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
      databaseNotPageError
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          notion_block_id: 'block-1',
          notion_page_id: 'row-1',
          notion_page_title: 'Cell Biology',
        }),
        sampleCard({
          notion_block_id: 'block-2',
          notion_page_id: 'row-2',
          notion_page_title: 'Genetics',
        }),
      ],
      diagnostic: {
        blocks_scanned: 4,
        blocks_matched: 2,
        pattern_hits: { toggle: 2 },
      },
    });

    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({
        notion_page_id: 'db-1',
        notion_page_title: 'Histology',
      })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      undefined,
      () => async () => [{ id: 'row-1' }, { id: 'row-2' }]
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'db-1',
      trigger: 'polling',
    });

    expect(ac.createDeck).toHaveBeenCalledWith('Notion Sync::Histology');
    expect(ac.createDeck).toHaveBeenCalledWith(
      'Notion Sync::Histology::Cell Biology'
    );
    expect(ac.createDeck).toHaveBeenCalledWith(
      'Notion Sync::Histology::Genetics'
    );
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        deckName: 'Notion Sync::Histology::Cell Biology',
      })
    );
    expect(repos.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: 'block-2',
        deck_name: 'Notion Sync::Histology::Genetics',
      })
    );
  });

  test('nests database child subdecks under the target deck override', async () => {
    const databaseNotPageError = Object.assign(
      new Error('db-1 is a database, not a page.'),
      { code: 'validation_error' }
    );
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
      databaseNotPageError
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          notion_page_id: 'row-1',
          notion_page_title: 'Cell Biology',
        }),
      ],
      diagnostic: {
        blocks_scanned: 2,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({
        notion_page_id: 'db-1',
        notion_page_title: 'Histology',
        target_deck: 'MS3::Histology',
      })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      undefined,
      () => async () => [{ id: 'row-1' }]
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'db-1',
      trigger: 'manual',
    });

    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        deckName: 'MS3::Histology::Cell Biology',
      })
    );
  });

  test('resolves the template override per database child page with the database as fallback', async () => {
    const databaseNotPageError = Object.assign(
      new Error('db-1 is a database, not a page.'),
      { code: 'validation_error' }
    );
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
      databaseNotPageError
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          notion_block_id: 'block-1',
          notion_page_id: 'row-1',
          notion_page_title: 'Cell Biology',
        }),
      ],
      diagnostic: {
        blocks_scanned: 2,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const templateOverridesProvider = jest.fn(async () => ({
      basicModelName: 'ATTI BASIC',
      basicTemplate: {
        parent: 'Basic',
        name: 'ATTI BASIC',
        storageKey: 'n2a-basic',
        front: '{{Front}}',
        back: '{{Back}}',
        styling: '.card { color: tomato; }',
      },
    }));
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      templateOverridesProvider,
      () => async () => [{ id: 'row-1' }]
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'db-1',
      trigger: 'polling',
    });

    expect(templateOverridesProvider).toHaveBeenCalledWith(42, 'db-1');
    expect(templateOverridesProvider).toHaveBeenCalledWith(42, 'row-1', 'db-1');
    expect(ac.addNote).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: 'ATTI BASIC' })
    );
  });

  test('moves existing parent-deck cards into their page subdeck even without a target deck', async () => {
    const databaseNotPageError = Object.assign(
      new Error('db-1 is a database, not a page.'),
      { code: 'validation_error' }
    );
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
      databaseNotPageError
    );
    (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          notion_block_id: 'block-1',
          notion_page_id: 'row-1',
          notion_page_title: 'Cell Biology',
        }),
      ],
      diagnostic: {
        blocks_scanned: 2,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({
        notion_page_id: 'db-1',
        notion_page_title: 'Histology',
        target_deck: null,
      })
    );
    const existingMapping = {
      id: 5,
      ankify_client_id: 1,
      source_id: 'block-1',
      source_type: 'notion_block' as const,
      anki_note_id: 900,
      deck_name: 'Notion Sync::Histology',
      content_hash: hashCardContent('Front text', 'Back text'),
      last_synced_at: new Date(2020, 0, 1),
    };
    repos.mappings.findBySourceId = jest.fn(
      async (_clientId: number, _sourceId: string) => existingMapping
    );
    const ac = makeAnkiConnectStub();
    (ac.notesInfo as jest.Mock).mockImplementation(async (notes: number[]) => {
      if (notes.includes(900)) {
        return [
          {
            noteId: 900,
            modelName: 'Ankify Basic',
            tags: [],
            fields: {
              Front: { value: 'Front text', order: 0 },
              Back: { value: 'Back text', order: 1 },
            },
            cards: [9001],
            mod: Math.floor(new Date(2020, 0, 1).getTime() / 1000),
          },
        ];
      }
      return [];
    });
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      undefined,
      undefined,
      undefined,
      () => async () => [{ id: 'row-1' }]
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'db-1',
      trigger: 'polling',
    });

    expect(ac.changeDeck).toHaveBeenCalledWith(
      [9001],
      'Notion Sync::Histology::Cell Biology'
    );
    expect(repos.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: 'block-1',
        anki_note_id: 900,
        deck_name: 'Notion Sync::Histology::Cell Biology',
      })
    );
  });

  test('does not call changeDeck when no target_deck is set', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    repos.subscriptions = makeSubscriptionsRepo(
      sampleSubscription({ notion_page_title: 'Algebra', target_deck: null })
    );
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.changeDeck).not.toHaveBeenCalled();
  });

  test('refreshes model styling and templates after ensuring models exist', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.updateModelStyling).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ankify Basic',
        css: expect.stringContaining('.card'),
      })
    );
    expect(ac.updateModelTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ankify Basic',
        templates: expect.objectContaining({
          'Card 1': expect.objectContaining({
            Front: expect.stringContaining('{{Front}}'),
            Back: expect.stringContaining('{{Back}}'),
          }),
        }),
      })
    );
  });

  test('downloads Notion file images and pushes them to media before addNote', async () => {
    const sampleFetcher = jest.fn(async (url: string) => {
      expect(url).toBe('https://prod-files.notion.so/img.png?signed=1');
      return { status: 200, data: Buffer.from('PNGDATA') };
    });

    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          back: 'See <img src="ankify-img-77.png">',
          media: [
            {
              block_id: 'img-77',
              kind: 'image',
              source: 'file',
              url: 'https://prod-files.notion.so/img.png?signed=1',
              filename: 'ankify-img-77.png',
            },
          ],
        }),
      ],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });

    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const callOrder: string[] = [];
    (ac.storeMediaFile as jest.Mock).mockImplementation(async () => {
      callOrder.push('storeMediaFile');
      return 'ankify-img-77.png';
    });
    (ac.addNote as jest.Mock).mockImplementation(async () => {
      callOrder.push('addNote');
      return 12345;
    });

    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      sampleFetcher
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(ac.storeMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'ankify-img-77.png',
        data: expect.any(String),
      })
    );
    expect(callOrder.indexOf('storeMediaFile')).toBeLessThan(
      callOrder.indexOf('addNote')
    );
  });

  test('downloads and stores external-hosted images so the card renders offline', async () => {
    const externalFetch = jest.fn(async () => ({
      status: 200,
      data: Buffer.from('PNGDATA'),
    }));
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          back: '<img src="ankify-img-ext.png">',
          media: [
            {
              block_id: 'img-ext',
              kind: 'image',
              source: 'external',
              url: 'https://cdn.example.com/x.png',
              filename: 'ankify-img-ext.png',
            },
          ],
        }),
      ],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      externalFetch
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });

    expect(externalFetch).toHaveBeenCalledWith('https://cdn.example.com/x.png');
    expect(ac.storeMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'ankify-img-ext.png',
        data: expect.any(String),
      })
    );
    expect(ac.addNote).toHaveBeenCalled();
  });

  test('skips fetching and storing media already present in the Anki collection', async () => {
    const sampleFetcher = jest.fn(async () => ({
      status: 200,
      data: Buffer.from('PNGDATA'),
    }));
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          back: 'See <img src="ankify-already.png">',
          media: [
            {
              block_id: 'already',
              kind: 'image',
              source: 'file',
              url: 'https://prod-files.notion.so/already.png?signed=1',
              filename: 'ankify-already.png',
            },
          ],
        }),
      ],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.getMediaFilesNames as jest.Mock).mockResolvedValue([
      'ankify-already.png',
    ]);

    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      sampleFetcher
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'polling',
    });

    expect(ac.getMediaFilesNames).toHaveBeenCalledWith('ankify-*');
    expect(sampleFetcher).not.toHaveBeenCalled();
    expect(ac.storeMediaFile).not.toHaveBeenCalled();
    expect(ac.addNote).toHaveBeenCalled();
  });

  test('fetches and stores media that is not yet in the Anki collection', async () => {
    const sampleFetcher = jest.fn(async () => ({
      status: 200,
      data: Buffer.from('PNGDATA'),
    }));
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          back: 'See <img src="ankify-new.png">',
          media: [
            {
              block_id: 'new',
              kind: 'image',
              source: 'file',
              url: 'https://prod-files.notion.so/new.png?signed=1',
              filename: 'ankify-new.png',
            },
          ],
        }),
      ],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.getMediaFilesNames as jest.Mock).mockResolvedValue([
      'ankify-something-else.png',
    ]);

    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      sampleFetcher
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'polling',
    });

    expect(sampleFetcher).toHaveBeenCalledWith(
      'https://prod-files.notion.so/new.png?signed=1'
    );
    expect(ac.storeMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'ankify-new.png' })
    );
  });

  test('falls back to fetching everything when getMediaFilesNames fails', async () => {
    const sampleFetcher = jest.fn(async () => ({
      status: 200,
      data: Buffer.from('PNGDATA'),
    }));
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          back: 'See <img src="ankify-fallback.png">',
          media: [
            {
              block_id: 'fallback',
              kind: 'image',
              source: 'file',
              url: 'https://prod-files.notion.so/fallback.png?signed=1',
              filename: 'ankify-fallback.png',
            },
          ],
        }),
      ],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    (ac.getMediaFilesNames as jest.Mock).mockRejectedValue(
      new Error('unknown action getMediaFilesNames')
    );

    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      sampleFetcher
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      })
    );

    expect(sampleFetcher).toHaveBeenCalledWith(
      'https://prod-files.notion.so/fallback.png?signed=1'
    );
    expect(ac.storeMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'ankify-fallback.png' })
    );
    expect(result.created).toBe(1);
  });

  test('records sync_logs error but does not fail when image download fails', async () => {
    const failingFetch = jest.fn(async () => {
      throw new Error('network down');
    });

    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [
        sampleCard({
          media: [
            {
              block_id: 'img-bad',
              kind: 'image',
              source: 'file',
              url: 'https://prod-files.notion.so/bad.png?signed=1',
              filename: 'ankify-img-bad.png',
            },
          ],
        }),
      ],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => [],
      undefined,
      failingFetch
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'manual',
      })
    );

    expect(ac.storeMediaFile).not.toHaveBeenCalled();
    expect(ac.addNote).toHaveBeenCalled();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/img-bad/);
  });

  test('orphan recovery: when a mapped Anki note no longer exists, drops the mapping and recreates the note', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const existingMapping = {
      id: 1,
      ankify_client_id: 1,
      source_id: 'block-1',
      source_type: 'notion_block' as const,
      anki_note_id: 9999,
      deck_name: 'Notion Sync::Untitled',
      content_hash: null,
      last_synced_at: new Date(Date.now() - 60_000),
    };
    repos.mappings.findBySourceId = jest.fn(
      async (_clientId: number, _sourceId: string) => existingMapping
    );
    repos.mappings.upsert = jest.fn(async (input) => ({
      ...existingMapping,
      anki_note_id: input.anki_note_id,
    }));
    const ac = makeAnkiConnectStub();
    (ac.notesInfo as jest.Mock).mockResolvedValueOnce([{}]);
    (ac.addNote as jest.Mock).mockResolvedValueOnce(424242);

    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      })
    );

    expect(repos.mappings.deleteByAnkiNoteId).toHaveBeenCalledWith(1, 9999);
    expect(ac.addNote).toHaveBeenCalled();
    expect(repos.mappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ anki_note_id: 424242, source_id: 'block-1' })
    );
    expect(ac.updateNoteFields).not.toHaveBeenCalled();
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([]);
  });

  test('a second sync for the same client reuses the cache and skips modelNames', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [sampleCard()],
      diagnostic: {
        blocks_scanned: 1,
        blocks_matched: 1,
        pattern_hits: { toggle: 1 },
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'manual',
    });
    (ac.modelNames as jest.Mock).mockClear();
    (ac.createModel as jest.Mock).mockClear();

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'polling',
    });

    expect(ac.modelNames).not.toHaveBeenCalled();
    expect(ac.createModel).not.toHaveBeenCalled();
  });

  test('disables subscription when runSync throws object_not_found', async () => {
    const notFoundError = Object.assign(new Error('Could not find object'), {
      code: 'object_not_found',
    });
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(notFoundError);
    const subscriptions = makeSubscriptionsRepo();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      makeClients(),
      makeMappings(),
      makeConflicts(),
      subscriptions,
      makeLogs(),
      makeNotionRepo(),
      () => ac,
      () => async () => []
    );

    let thrownError: unknown;
    try {
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      });
    } catch (error) {
      thrownError = error;
    }

    expect((thrownError as Error).message).toBe('Could not find object');
    expect(subscriptions.setEnabled).toHaveBeenCalledWith(1, false);
    expect(subscriptions.recordPoll).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ error: 'Could not find object' })
    );
  });

  test('result includes a diagnostic when walkNotionPageForFlashcards returns one', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [],
      diagnostic: {
        blocks_scanned: 5,
        blocks_matched: 0,
        pattern_hits: {},
        unmatched_samples: ['Introduction', 'Summary'],
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    const result = expectSyncResult(
      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'manual',
      })
    );

    expect(result.diagnostic).toEqual({
      blocks_scanned: 5,
      blocks_matched: 0,
      pattern_hits: {},
      unmatched_samples: ['Introduction', 'Summary'],
    });
  });

  test('diagnostic is persisted in the sync log payload', async () => {
    (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
      cards: [],
      diagnostic: {
        blocks_scanned: 3,
        blocks_matched: 0,
        pattern_hits: {},
        unmatched_samples: ['Heading A'],
      },
    });
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await useCase.execute({
      owner: 42,
      notionPageId: 'page-id',
      trigger: 'polling',
    });

    expect(repos.logs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          diagnostic: expect.objectContaining({
            blocks_scanned: 3,
            blocks_matched: 0,
            unmatched_samples: ['Heading A'],
          }),
        }),
      })
    );
  });

  test('does not disable subscription for non-not-found errors', async () => {
    const genericError = new Error('rate_limited');
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(genericError);
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await expect(
      useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      })
    ).rejects.toThrow('rate_limited');

    expect(repos.subscriptions.setEnabled).not.toHaveBeenCalled();
  });

  describe('zero-card structured event emission', () => {
    it('tracks ankify_zero_cards analytics event when page produces no cards', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [],
        diagnostic: { blocks_scanned: 5, blocks_matched: 0, pattern_hits: {} },
      });

      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'page-abc',
        trigger: 'manual',
      });

      expect(mockTrack).toHaveBeenCalledWith('ankify_zero_cards', {
        userId: 42,
        props: expect.objectContaining({
          source_type: 'notion_page',
          parser_path: 'ankify/notionPageWalker',
          reason_code: 'all_blocks_unmatched',
          blocks_scanned: 5,
          trigger: 'manual',
        }),
      });
    });

    it('derives reason_code empty_page when blocks_scanned is zero', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [],
        diagnostic: { blocks_scanned: 0, blocks_matched: 0, pattern_hits: {} },
      });

      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'page-empty',
        trigger: 'polling',
      });

      expect(mockTrack).toHaveBeenCalledWith(
        'ankify_zero_cards',
        expect.objectContaining({
          props: expect.objectContaining({ reason_code: 'empty_page' }),
        })
      );
    });

    it('does not track ankify_zero_cards when cards are produced', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [sampleCard()],
        diagnostic: {
          blocks_scanned: 1,
          blocks_matched: 1,
          pattern_hits: { toggle: 1 },
        },
      });

      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'page-with-cards',
        trigger: 'manual',
      });

      expect(mockTrack).not.toHaveBeenCalledWith(
        'ankify_zero_cards',
        expect.anything()
      );
    });

    it('does not route the zero-card diagnostic to the error dashboard', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [],
        diagnostic: { blocks_scanned: 3, blocks_matched: 0, pattern_hits: {} },
      });

      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'page-no-repo',
        trigger: 'manual',
      });

      const trackedNames = mockTrack.mock.calls.map((call) => call[0]);
      expect(trackedNames).toContain('ankify_zero_cards');
      expect(trackedNames).not.toContain('ankify.zero_cards');
    });
  });

  describe('benign sync diagnostics never reach the error feed', () => {
    const ERROR_FEED_MESSAGES = [
      'ankify.zero_cards',
      'ankify.sync_followed_deck',
    ];

    const followedDeckSubscription = () =>
      makeSubscriptionsRepo(
        sampleSubscription({
          notion_page_title: 'Pharmacology',
          target_deck: 'MS3::Pharmacology',
        })
      );

    const followedDeckMapping = {
      id: 5,
      ankify_client_id: 1,
      source_id: 'block-1',
      source_type: 'notion_block' as const,
      anki_note_id: 900,
      deck_name: 'Notion Sync::Pharmacology',
      content_hash: hashCardContent('Front text', 'Back text'),
      last_synced_at: new Date(2020, 0, 1),
    };

    const stubFollowedDeckNotesInfo = (ac: AnkiConnectClient) => {
      (ac.notesInfo as jest.Mock).mockImplementation(
        async (notes: number[]) => {
          if (notes.includes(900)) {
            return [
              {
                noteId: 900,
                modelName: 'Ankify Basic',
                tags: [],
                fields: {
                  Front: { value: 'Front text', order: 0 },
                  Back: { value: 'Back text', order: 1 },
                },
                cards: [9001, 9002],
                mod: Math.floor(new Date(2020, 0, 1).getTime() / 1000),
              },
            ];
          }
          return [];
        }
      );
    };

    it('routes the followed-deck diagnostic to analytics, not the error feed', async () => {
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [sampleCard()],
        diagnostic: {
          blocks_scanned: 1,
          blocks_matched: 1,
          pattern_hits: { toggle: 1 },
        },
      });
      const repos = makeRepos();
      repos.subscriptions = followedDeckSubscription();
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, _sourceId: string) => followedDeckMapping
      );
      const ac = makeAnkiConnectStub();
      stubFollowedDeckNotesInfo(ac);

      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      });

      const trackedNames = mockTrack.mock.calls.map((call) => call[0]);
      expect(trackedNames).toContain('ankify_sync_followed_deck');
      for (const message of ERROR_FEED_MESSAGES) {
        expect(trackedNames).not.toContain(message);
      }
    });

    it('builds the production use case without an error-event sink', () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();

      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      expect(useCase).toBeInstanceOf(SyncNotionPageToRacUseCase);
      const sink = (useCase as unknown as Record<string, unknown>).errorEvents;
      expect(sink).toBeUndefined();
    });
  });

  test('marks token invalid and disables subscription when Notion returns Unauthorized', async () => {
    const unauthorizedError = Object.assign(
      new Error('API token is invalid.'),
      {
        code: 'unauthorized',
        status: 401,
      }
    );
    (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
      unauthorizedError
    );
    const repos = makeRepos();
    const ac = makeAnkiConnectStub();
    const useCase = new SyncNotionPageToRacUseCase(
      repos.clients,
      repos.mappings,
      repos.conflicts,
      repos.subscriptions,
      repos.logs,
      repos.notionRepo,
      () => ac,
      () => async () => []
    );

    await expect(
      useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      })
    ).rejects.toThrow('API token is invalid.');

    expect(repos.notionRepo.markTokenInvalid).toHaveBeenCalledWith(42);
    expect(repos.subscriptions.setEnabled).toHaveBeenCalledWith(1, false);
  });

  describe('default media fetcher routes through the SSRF guard', () => {
    const fileMediaCard = (url: string) =>
      sampleCard({
        back: 'See <img src="ankify-img-1.png">',
        media: [
          {
            block_id: 'img-1',
            kind: 'image',
            source: 'file',
            url,
            filename: 'ankify-img-1.png',
          },
        ],
      });

    beforeEach(() => {
      mockAxiosGet.mockReset();
      mockDnsLookup.mockReset();
    });

    const buildUseCase = (
      repos: ReturnType<typeof makeRepos>,
      ac: AnkiConnectClient
    ) =>
      new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

    it('refuses a loopback media URL and stores no media', async () => {
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [fileMediaCard('http://127.0.0.1/secret.png')],
        diagnostic: {
          blocks_scanned: 1,
          blocks_matched: 1,
          pattern_hits: { toggle: 1 },
        },
      });
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();

      const result = expectSyncResult(
        await buildUseCase(repos, ac).execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'manual',
        })
      );

      expect(mockAxiosGet).not.toHaveBeenCalled();
      expect(ac.storeMediaFile).not.toHaveBeenCalled();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/img-1/);
      expect(ac.addNote).toHaveBeenCalled();
    });

    it('refuses a link-local metadata media URL and stores no media', async () => {
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [fileMediaCard('http://169.254.169.254/latest/meta-data/')],
        diagnostic: {
          blocks_scanned: 1,
          blocks_matched: 1,
          pattern_hits: { toggle: 1 },
        },
      });
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();

      const result = expectSyncResult(
        await buildUseCase(repos, ac).execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'manual',
        })
      );

      expect(mockAxiosGet).not.toHaveBeenCalled();
      expect(ac.storeMediaFile).not.toHaveBeenCalled();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('fetches a public media URL through the guard and stores the bytes', async () => {
      mockDnsLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ]);
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: Buffer.from('PNGDATA'),
      });
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [fileMediaCard('https://prod-files.notion.so/img.png?signed=1')],
        diagnostic: {
          blocks_scanned: 1,
          blocks_matched: 1,
          pattern_hits: { toggle: 1 },
        },
      });
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();

      const result = expectSyncResult(
        await buildUseCase(repos, ac).execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'manual',
        })
      );

      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://prod-files.notion.so/img.png?signed=1',
        expect.objectContaining({ responseType: 'arraybuffer' })
      );
      expect(ac.storeMediaFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'ankify-img-1.png',
          data: Buffer.from('PNGDATA').toString('base64'),
        })
      );
      expect(result.errors).toEqual([]);
    });
  });

  describe('object-type memory and offline pre-check', () => {
    test('records the resolved object type as database after the not-page fallback', async () => {
      const databaseNotPageError = Object.assign(
        new Error('Provided ID is a database, not a page.'),
        { code: 'validation_error' }
      );
      (walkNotionPageForFlashcards as jest.Mock).mockRejectedValue(
        databaseNotPageError
      );
      (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
        cards: [sampleCard()],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => [],
        undefined,
        undefined,
        undefined,
        undefined,
        () => async () => [{ id: 'row-1' }]
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'database-id',
        trigger: 'polling',
      });

      expect(repos.subscriptions.recordObjectType).toHaveBeenCalledWith(
        1,
        'database'
      );
    });

    test('skips the page walk entirely when the object type is already known to be a database', async () => {
      (walkNotionDatabaseForFlashcards as jest.Mock).mockResolvedValue({
        cards: [sampleCard()],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      repos.subscriptions.upsert.mockResolvedValue(
        sampleSubscription({ notion_object_type: 'database' })
      );
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => [],
        undefined,
        undefined,
        undefined,
        undefined,
        () => async () => [{ id: 'row-1' }]
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'database-id',
        knownObjectType: 'database',
        trigger: 'polling',
      });

      expect(walkNotionPageForFlashcards).not.toHaveBeenCalled();
      expect(walkNotionDatabaseForFlashcards).toHaveBeenCalledTimes(1);
    });

    test('skips the Notion fetch and records a calm last_error when AnkiConnect is offline on a poll', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      (ac.ping as jest.Mock).mockRejectedValue(
        new AnkiConnectUnreachableError('http://localhost:20000', null)
      );
      repos.subscriptions.findByOwnerAndPageId.mockResolvedValue(
        sampleSubscription({ id: 55 })
      );
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      });

      expect(isAnkifyClientOfflineSkip(result)).toBe(true);
      expect(walkNotionPageForFlashcards).not.toHaveBeenCalled();
      expect(walkNotionDatabaseForFlashcards).not.toHaveBeenCalled();
      expect(repos.subscriptions.recordPoll).toHaveBeenCalledWith(55, {
        error: ANKI_OFFLINE_SKIP_MESSAGE,
      });
      expect(repos.subscriptions.upsert).not.toHaveBeenCalled();
    });

    test('does not pre-empt a manual sync when AnkiConnect is offline — the sync proceeds and surfaces the error naturally', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      (ac.ping as jest.Mock).mockRejectedValue(
        new AnkiConnectUnreachableError('http://localhost:20000', null)
      );
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'manual',
      });

      expect(walkNotionPageForFlashcards).toHaveBeenCalledTimes(1);
    });

    test('calmly skips a poll and records a calm last_error when the owner has no active Anki client', async () => {
      const repos = makeRepos();
      repos.clients.findActiveByOwner.mockResolvedValue(null);
      repos.subscriptions.findByOwnerAndPageId.mockResolvedValue(
        sampleSubscription({ id: 77 })
      );
      const ac = makeAnkiConnectStub();
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      });

      expect(isAnkifyClientOfflineSkip(result)).toBe(true);
      expect(walkNotionPageForFlashcards).not.toHaveBeenCalled();
      expect(repos.subscriptions.upsert).not.toHaveBeenCalled();
      expect(repos.subscriptions.recordPoll).toHaveBeenCalledWith(77, {
        error: ANKI_OFFLINE_SKIP_MESSAGE,
      });
    });

    test('still throws NoActiveAnkifyClientError on a manual sync when the owner has no active Anki client', async () => {
      const repos = makeRepos();
      repos.clients.findActiveByOwner.mockResolvedValue(null);
      const ac = makeAnkiConnectStub();
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      await expect(
        useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'manual',
        })
      ).rejects.toBeInstanceOf(NoActiveAnkifyClientError);
      expect(repos.subscriptions.recordPoll).not.toHaveBeenCalled();
    });
  });

  describe('batch mod-time prefilter', () => {
    const unchangedMapping = () => ({
      id: 5,
      ankify_client_id: 1,
      source_id: 'block-1',
      source_type: 'notion_block' as const,
      anki_note_id: 900,
      deck_name: 'Notion Sync::Algebra',
      content_hash: hashCardContent('Front text', 'Back text'),
      last_synced_at: new Date('2026-01-01T00:00:00Z'),
    });

    const reflectingStub = (actions: string[]) => {
      const ac = makeAnkiConnectStub();
      (ac.apiReflect as jest.Mock).mockResolvedValue(actions);
      return ac;
    };

    test('skips the full notesInfo fetch when both Notion and Anki are unchanged', async () => {
      const lastSyncedSeconds = Math.floor(
        new Date('2026-01-01T00:00:00Z').getTime() / 1000
      );
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [
          sampleCard({
            notion_block_id: 'block-1',
            notion_last_edited_at: new Date('2025-12-01T00:00:00Z'),
          }),
        ],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      repos.subscriptions = makeSubscriptionsRepo(
        sampleSubscription({ notion_page_title: 'Algebra' })
      );
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, sourceId: string) => ({
          ...unchangedMapping(),
          source_id: sourceId,
        })
      );
      const ac = reflectingStub(['notesModTime', 'multi']);
      (ac.notesModTime as jest.Mock).mockResolvedValue([
        { noteId: 900, mod: lastSyncedSeconds - 10 },
      ]);
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(ac.notesModTime).toHaveBeenCalledWith([900]);
      expect(ac.notesInfo).not.toHaveBeenCalled();
      expect(result.unchanged).toBe(1);
      expect(result.updated).toBe(0);
    });

    test('fetches full info only for the note whose Anki mod advanced past last sync', async () => {
      const lastSyncedSeconds = Math.floor(
        new Date('2026-01-01T00:00:00Z').getTime() / 1000
      );
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [
          sampleCard({
            notion_block_id: 'block-1',
            notion_last_edited_at: new Date('2025-12-01T00:00:00Z'),
          }),
          sampleCard({
            notion_block_id: 'block-2',
            front: 'Front 2',
            back: 'Back 2',
            notion_last_edited_at: new Date('2025-12-01T00:00:00Z'),
          }),
        ],
        diagnostic: { blocks_scanned: 2, blocks_matched: 2, pattern_hits: {} },
      });
      const repos = makeRepos();
      repos.subscriptions = makeSubscriptionsRepo(
        sampleSubscription({ notion_page_title: 'Algebra' })
      );
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, sourceId: string) => ({
          ...unchangedMapping(),
          source_id: sourceId,
          anki_note_id: sourceId === 'block-1' ? 900 : 901,
        })
      );
      const ac = reflectingStub(['notesModTime', 'multi']);
      (ac.notesModTime as jest.Mock).mockResolvedValue([
        { noteId: 900, mod: lastSyncedSeconds - 10 },
        { noteId: 901, mod: lastSyncedSeconds + 50 },
      ]);
      (ac.notesInfo as jest.Mock).mockImplementation(
        async (notes: number[]) => {
          if (notes.includes(901)) {
            return [
              {
                noteId: 901,
                modelName: 'Ankify Basic',
                tags: [],
                fields: {
                  Front: { value: 'stale front', order: 0 },
                  Back: { value: 'stale back', order: 1 },
                },
                cards: [9101],
                mod: lastSyncedSeconds + 50,
              },
            ];
          }
          return [];
        }
      );
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      const fetchedNoteIds = (ac.notesInfo as jest.Mock).mock.calls.flatMap(
        (call) => call[0] as number[]
      );
      expect(ac.notesModTime).toHaveBeenCalledTimes(1);
      expect(fetchedNoteIds).toContain(901);
      expect(fetchedNoteIds).not.toContain(900);
    });

    test('batches changed-note full info into a single notesInfo call', async () => {
      const lastSyncedSeconds = Math.floor(
        new Date('2026-01-01T00:00:00Z').getTime() / 1000
      );
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [
          sampleCard({
            notion_block_id: 'block-1',
            front: 'New front 1',
            notion_last_edited_at: new Date('2026-02-01T00:00:00Z'),
          }),
          sampleCard({
            notion_block_id: 'block-2',
            front: 'New front 2',
            notion_last_edited_at: new Date('2026-02-01T00:00:00Z'),
          }),
        ],
        diagnostic: { blocks_scanned: 2, blocks_matched: 2, pattern_hits: {} },
      });
      const repos = makeRepos();
      repos.subscriptions = makeSubscriptionsRepo(
        sampleSubscription({ notion_page_title: 'Algebra' })
      );
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, sourceId: string) => ({
          ...unchangedMapping(),
          source_id: sourceId,
          anki_note_id: sourceId === 'block-1' ? 900 : 901,
        })
      );
      const ac = reflectingStub(['notesModTime', 'multi']);
      (ac.notesModTime as jest.Mock).mockResolvedValue([
        { noteId: 900, mod: lastSyncedSeconds - 10 },
        { noteId: 901, mod: lastSyncedSeconds - 10 },
      ]);
      (ac.notesInfo as jest.Mock).mockImplementation(async (notes: number[]) =>
        notes.map((noteId) => ({
          noteId,
          modelName: 'Ankify Basic',
          tags: [],
          fields: {
            Front: { value: 'stale', order: 0 },
            Back: { value: 'Back text', order: 1 },
          },
          cards: [noteId + 9000],
          mod: lastSyncedSeconds - 10,
        }))
      );
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(ac.notesInfo).toHaveBeenCalledTimes(1);
      expect(ac.notesInfo).toHaveBeenCalledWith([900, 901]);
      expect(result.updated).toBe(2);
    });

    test('falls back to per-note notesInfo when notesModTime is absent from apiReflect', async () => {
      const lastSyncedSeconds = Math.floor(
        new Date('2026-01-01T00:00:00Z').getTime() / 1000
      );
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [
          sampleCard({
            notion_block_id: 'block-1',
            notion_last_edited_at: new Date('2025-12-01T00:00:00Z'),
          }),
        ],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      repos.subscriptions = makeSubscriptionsRepo(
        sampleSubscription({ notion_page_title: 'Algebra' })
      );
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, sourceId: string) => ({
          ...unchangedMapping(),
          source_id: sourceId,
        })
      );
      const ac = reflectingStub(['deckNames', 'addNote']);
      (ac.notesInfo as jest.Mock).mockResolvedValue([
        {
          noteId: 900,
          modelName: 'Ankify Basic',
          tags: [],
          fields: {
            Front: { value: 'Front text', order: 0 },
            Back: { value: 'Back text', order: 1 },
          },
          cards: [9001],
          mod: lastSyncedSeconds - 10,
        },
      ]);
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(ac.notesModTime).not.toHaveBeenCalled();
      expect(ac.notesInfo).toHaveBeenCalledWith([900]);
      expect(result.unchanged).toBe(1);
    });

    test('skips the prefilter when there are no existing mappings', async () => {
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [sampleCard({ notion_block_id: 'block-1' })],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      const ac = reflectingStub(['notesModTime', 'multi']);
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(ac.notesModTime).not.toHaveBeenCalled();
      expect(result.created).toBe(1);
    });
  });

  describe('content-hash refresh of existing cards', () => {
    const reflectingStub = (actions: string[]) => {
      const ac = makeAnkiConnectStub();
      (ac.apiReflect as jest.Mock).mockResolvedValue(actions);
      return ac;
    };

    const ankiNoteInfo = (noteId: number, mod: number) => ({
      noteId,
      modelName: 'Ankify Basic',
      tags: [],
      fields: {
        Front: { value: 'Front text', order: 0 },
        Back: { value: 'Back text', order: 1 },
      },
      cards: [noteId + 9000],
      mod,
    });

    test('rewrites an unedited card whose rendered content no longer matches the stored hash', async () => {
      const lastSyncedSeconds = Math.floor(
        new Date('2026-01-01T00:00:00Z').getTime() / 1000
      );
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [
          sampleCard({
            notion_block_id: 'block-1',
            back: 'See <span style="color: red">this</span>',
            notion_last_edited_at: new Date('2025-12-01T00:00:00Z'),
          }),
        ],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      repos.subscriptions = makeSubscriptionsRepo(
        sampleSubscription({ notion_page_title: 'Algebra' })
      );
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, sourceId: string) => ({
          id: 5,
          ankify_client_id: 1,
          source_id: sourceId,
          source_type: 'notion_block' as const,
          anki_note_id: 900,
          deck_name: 'Notion Sync::Algebra',
          content_hash: hashCardContent('Front text', 'Back text'),
          last_synced_at: new Date('2026-01-01T00:00:00Z'),
        })
      );
      const ac = reflectingStub(['notesModTime', 'multi']);
      (ac.notesModTime as jest.Mock).mockResolvedValue([
        { noteId: 900, mod: lastSyncedSeconds - 10 },
      ]);
      (ac.notesInfo as jest.Mock).mockResolvedValue([
        ankiNoteInfo(900, lastSyncedSeconds - 10),
      ]);
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(ac.updateNoteFields).toHaveBeenCalledWith(900, {
        Front: 'Front text',
        Back: 'See <span style="color: red">this</span>',
      });
      expect(ac.addNote).not.toHaveBeenCalled();
      expect(ac.changeDeck).not.toHaveBeenCalled();
      expect(repos.mappings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          source_id: 'block-1',
          anki_note_id: 900,
          content_hash: hashCardContent(
            'Front text',
            'See <span style="color: red">this</span>'
          ),
        })
      );
      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(0);
    });

    test('rewrites an unedited card whose stored hash is null (installed base)', async () => {
      const lastSyncedSeconds = Math.floor(
        new Date('2026-01-01T00:00:00Z').getTime() / 1000
      );
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [
          sampleCard({
            notion_block_id: 'block-1',
            notion_last_edited_at: new Date('2025-12-01T00:00:00Z'),
          }),
        ],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      repos.subscriptions = makeSubscriptionsRepo(
        sampleSubscription({ notion_page_title: 'Algebra' })
      );
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, sourceId: string) => ({
          id: 5,
          ankify_client_id: 1,
          source_id: sourceId,
          source_type: 'notion_block' as const,
          anki_note_id: 900,
          deck_name: 'Notion Sync::Algebra',
          content_hash: null,
          last_synced_at: new Date('2026-01-01T00:00:00Z'),
        })
      );
      const ac = reflectingStub(['notesModTime', 'multi']);
      (ac.notesModTime as jest.Mock).mockResolvedValue([
        { noteId: 900, mod: lastSyncedSeconds - 10 },
      ]);
      (ac.notesInfo as jest.Mock).mockResolvedValue([
        {
          ...ankiNoteInfo(900, lastSyncedSeconds - 10),
          fields: {
            Front: { value: 'Front text', order: 0 },
            Back: { value: 'old plain back', order: 1 },
          },
        },
      ]);
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(ac.updateNoteFields).toHaveBeenCalledWith(900, {
        Front: 'Front text',
        Back: 'Back text',
      });
      expect(result.updated).toBe(1);
    });

    test('leaves a card untouched when both Notion and the rendered hash are unchanged', async () => {
      const lastSyncedSeconds = Math.floor(
        new Date('2026-01-01T00:00:00Z').getTime() / 1000
      );
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [
          sampleCard({
            notion_block_id: 'block-1',
            notion_last_edited_at: new Date('2025-12-01T00:00:00Z'),
          }),
        ],
        diagnostic: { blocks_scanned: 1, blocks_matched: 1, pattern_hits: {} },
      });
      const repos = makeRepos();
      repos.subscriptions = makeSubscriptionsRepo(
        sampleSubscription({ notion_page_title: 'Algebra' })
      );
      repos.mappings.findBySourceId = jest.fn(
        async (_clientId: number, sourceId: string) => ({
          id: 5,
          ankify_client_id: 1,
          source_id: sourceId,
          source_type: 'notion_block' as const,
          anki_note_id: 900,
          deck_name: 'Notion Sync::Algebra',
          content_hash: hashCardContent('Front text', 'Back text'),
          last_synced_at: new Date('2026-01-01T00:00:00Z'),
        })
      );
      const ac = reflectingStub(['notesModTime', 'multi']);
      (ac.notesModTime as jest.Mock).mockResolvedValue([
        { noteId: 900, mod: lastSyncedSeconds - 10 },
      ]);
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => []
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(ac.notesInfo).not.toHaveBeenCalled();
      expect(ac.updateNoteFields).not.toHaveBeenCalled();
      expect(result.unchanged).toBe(1);
      expect(result.updated).toBe(0);
    });
  });

  describe('unsupported block telemetry', () => {
    const makeUnsupportedRepo = () => ({
      record: jest.fn(async () => undefined),
      list: jest.fn(async () => []),
    });

    beforeEach(() => {
      (walkNotionPageForFlashcards as jest.Mock).mockReset();
      (walkNotionPageForFlashcards as jest.Mock).mockResolvedValue({
        cards: [sampleCard()],
        diagnostic: {
          blocks_scanned: 3,
          blocks_matched: 1,
          pattern_hits: { toggle: 1 },
        },
        unsupportedTypes: ['html', 'html', 'unsupported_widget'],
      });
    });

    test('records the dropped block types once per conversion', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      const unsupportedRepo = makeUnsupportedRepo();
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        unsupportedRepo
      );

      await useCase.execute({
        owner: 42,
        notionPageId: 'page-id',
        trigger: 'polling',
      });

      expect(unsupportedRepo.record).toHaveBeenCalledTimes(1);
      expect(unsupportedRepo.record).toHaveBeenCalledWith([
        'html',
        'html',
        'unsupported_widget',
      ]);
    });

    test('a telemetry write failure does not fail the sync', async () => {
      const repos = makeRepos();
      const ac = makeAnkiConnectStub();
      const unsupportedRepo = makeUnsupportedRepo();
      unsupportedRepo.record.mockRejectedValue(new Error('db down'));
      const useCase = new SyncNotionPageToRacUseCase(
        repos.clients,
        repos.mappings,
        repos.conflicts,
        repos.subscriptions,
        repos.logs,
        repos.notionRepo,
        () => ac,
        () => async () => [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        unsupportedRepo
      );

      const result = expectSyncResult(
        await useCase.execute({
          owner: 42,
          notionPageId: 'page-id',
          trigger: 'polling',
        })
      );

      expect(result.created).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });
});
