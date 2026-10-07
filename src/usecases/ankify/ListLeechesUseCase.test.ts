import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import {
  AnkiConnectClient,
  AnkiConnectTimeoutError,
  AnkiConnectUnreachableError,
} from '../../services/ankify/AnkiConnectClient';
import { ListLeechesUseCase } from './ListLeechesUseCase';

const activeClient = {
  id: 1,
  owner: 42,
  anki_port: 8765,
  anki_connect_api_key: 'k',
} as unknown as Awaited<
  ReturnType<AnkifyClientsRepositoryInterface['findActiveByOwner']>
>;

const clientsRepo = (
  client: Awaited<
    ReturnType<AnkifyClientsRepositoryInterface['findActiveByOwner']>
  >
): AnkifyClientsRepositoryInterface =>
  ({
    findActiveByOwner: vi.fn(async () => client),
  }) as unknown as AnkifyClientsRepositoryInterface;

const subsRepo = (
  rows: { target_deck: string | null; notion_page_title: string | null }[]
): AnkifyNotionSubscriptionsRepositoryInterface =>
  ({
    listByOwner: vi.fn(async () => rows),
  }) as unknown as AnkifyNotionSubscriptionsRepositoryInterface;

describe('ListLeechesUseCase', () => {
  test('returns connected:false when there is no active client', async () => {
    const useCase = new ListLeechesUseCase(
      clientsRepo(null),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      vi.fn()
    );

    expect(await useCase.execute({ owner: 42 })).toEqual({ connected: false });
  });

  test('returns an empty list without touching AnkiConnect when no decks are owned', async () => {
    const factory = vi.fn();
    const useCase = new ListLeechesUseCase(
      clientsRepo(activeClient),
      subsRepo([]),
      factory
    );

    expect(await useCase.execute({ owner: 42 })).toEqual({
      connected: true,
      leeches: [],
    });
    expect(factory).not.toHaveBeenCalled();
  });

  test('maps notes to LeechNote shape sorted most-lapses-first', async () => {
    const findNotes = vi.fn(async () => [7001, 7002]);
    const notesInfo = vi.fn(async () => [
      {
        noteId: 7001,
        modelName: 'Basic',
        tags: ['leech'],
        fields: {
          Front: { value: 'A front', order: 0 },
          Back: { value: 'A back', order: 1 },
        },
        cards: [11],
      },
      {
        noteId: 7002,
        modelName: 'Basic',
        tags: ['leech', 'pharma'],
        fields: {
          Front: { value: 'B front', order: 0 },
          Back: { value: 'B back', order: 1 },
        },
        cards: [22],
      },
    ]);
    const cardsInfo = vi.fn(async () => [
      {
        cardId: 11,
        note: 7001,
        deckName: 'Notion Sync::Pharma',
        lapses: 8,
        queue: -1,
      },
      {
        cardId: 22,
        note: 7002,
        deckName: 'Notion Sync::Pharma',
        lapses: 12,
        queue: -1,
      },
    ]);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes,
          notesInfo,
          cardsInfo,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ListLeechesUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    const result = await useCase.execute({ owner: 42 });

    expect(findNotes).toHaveBeenCalledWith(
      'tag:leech (deck:"Notion Sync::Pharma")'
    );
    expect(result).toEqual({
      connected: true,
      leeches: [
        {
          noteId: 7002,
          deckName: 'Notion Sync::Pharma',
          modelName: 'Basic',
          fields: [
            { name: 'Front', value: 'B front' },
            { name: 'Back', value: 'B back' },
          ],
          tags: ['leech', 'pharma'],
          lapses: 12,
          suspended: true,
        },
        {
          noteId: 7001,
          deckName: 'Notion Sync::Pharma',
          modelName: 'Basic',
          fields: [
            { name: 'Front', value: 'A front' },
            { name: 'Back', value: 'A back' },
          ],
          tags: ['leech'],
          lapses: 8,
          suspended: true,
        },
      ],
    });
  });

  test('returns an empty list when no leech notes match', async () => {
    const findNotes = vi.fn(async () => []);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes,
          notesInfo: vi.fn(),
          cardsInfo: vi.fn(),
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ListLeechesUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    expect(await useCase.execute({ owner: 42 })).toEqual({
      connected: true,
      leeches: [],
    });
  });

  test('degrades to connected:false when AnkiConnect is unreachable on ping', async () => {
    const findNotes = vi.fn();
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => {
            throw new AnkiConnectUnreachableError(
              'http://x',
              new Error('down')
            );
          }),
          findNotes,
          notesInfo: vi.fn(),
          cardsInfo: vi.fn(),
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ListLeechesUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    expect(await useCase.execute({ owner: 42 })).toEqual({ connected: false });
    expect(findNotes).not.toHaveBeenCalled();
  });

  test('degrades to connected:false when a timeout subclass is thrown', async () => {
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes: vi.fn(async () => {
            throw new AnkiConnectTimeoutError(
              'http://x',
              'findNotes',
              10_000,
              new Error('slow')
            );
          }),
          notesInfo: vi.fn(),
          cardsInfo: vi.fn(),
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ListLeechesUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    expect(await useCase.execute({ owner: 42 })).toEqual({ connected: false });
  });

  test('degrades to connected:false when the body read fails mid-stream', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const action = JSON.parse(init.body).action as string;
      if (action === 'version') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ result: 6, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new TypeError('fetch failed');
        },
      };
    }) as unknown as typeof fetch;
    const factory = vi.fn(
      () => new AnkiConnectClient('http://x', fetchImpl, 5000)
    );
    const useCase = new ListLeechesUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    expect(await useCase.execute({ owner: 42 })).toEqual({ connected: false });
  });

  test('rethrows a non-AnkiConnect error so real bugs surface', async () => {
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => {
            throw new Error('unexpected');
          }),
          findNotes: vi.fn(),
          notesInfo: vi.fn(),
          cardsInfo: vi.fn(),
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ListLeechesUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    await expect(useCase.execute({ owner: 42 })).rejects.toThrow('unexpected');
  });
});
