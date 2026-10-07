import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { GetDeckMaturityUseCase } from './GetDeckMaturityUseCase';
import { DeckNotOwnedError } from './OpenDeckInAnkiUseCase';

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

describe('GetDeckMaturityUseCase', () => {
  test('counts mature cards at the 21-day boundary and averages intervals', async () => {
    const findCards = vi.fn(async () => [1, 2, 3, 4]);
    const getIntervals = vi.fn(async () => [21, 30, 20, 5]);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          getIntervals,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetDeckMaturityUseCase(
      clientsRepo(activeClient),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      factory
    );

    const result = await useCase.execute({ owner: 42, deck: 'MS3::Pharma' });

    expect(result).toEqual({
      connected: true,
      matureCount: 2,
      total: 4,
      avgIntervalDays: 19,
    });
    expect(findCards).toHaveBeenCalledWith('deck:"MS3::Pharma" -is:new');
  });

  test('quotes a hierarchical deck name in the findCards query', async () => {
    const findCards = vi.fn(async () => []);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          getIntervals: vi.fn(),
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetDeckMaturityUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Biochem', notion_page_title: null },
      ]),
      factory
    );

    await useCase.execute({ owner: 42, deck: 'Notion Sync::Biochem' });

    expect(findCards).toHaveBeenCalledWith(
      'deck:"Notion Sync::Biochem" -is:new'
    );
  });

  test('returns zeros when the deck has no reviewed cards', async () => {
    const getIntervals = vi.fn();
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards: vi.fn(async () => []),
          getIntervals,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetDeckMaturityUseCase(
      clientsRepo(activeClient),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      factory
    );

    const result = await useCase.execute({ owner: 42, deck: 'MS3::Pharma' });

    expect(result).toEqual({
      connected: true,
      matureCount: 0,
      total: 0,
      avgIntervalDays: 0,
    });
    expect(getIntervals).not.toHaveBeenCalled();
  });

  test('rejects a deck the user does not own', async () => {
    const factory = vi.fn();
    const useCase = new GetDeckMaturityUseCase(
      clientsRepo(activeClient),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, deck: 'Default' })
    ).rejects.toBeInstanceOf(DeckNotOwnedError);
    expect(factory).not.toHaveBeenCalled();
  });

  test('returns connected false when there is no active client', async () => {
    const useCase = new GetDeckMaturityUseCase(
      clientsRepo(null),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      vi.fn()
    );

    expect(await useCase.execute({ owner: 42, deck: 'MS3::Pharma' })).toEqual({
      connected: false,
    });
  });
});
