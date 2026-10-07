import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { GetReviewQueueUseCase } from './GetReviewQueueUseCase';

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

interface AnkiStub {
  due?: number[];
  fresh?: number[];
  newCount?: number;
}

const factoryFor = (stub: AnkiStub) => {
  const findCards = vi.fn(async (query: string) =>
    query.includes('is:new') ? (stub.fresh ?? []) : (stub.due ?? [])
  );
  const getDeckStats = vi.fn(async () => ({
    '1651445861967': {
      deck_id: 1651445861967,
      name: 'Deck',
      new_count: stub.newCount ?? 0,
      learn_count: 0,
      review_count: 0,
      total_in_deck: 0,
    },
  }));
  const factory = vi.fn(
    () =>
      ({
        ping: vi.fn(async () => 6),
        findCards,
        getDeckStats,
      }) as unknown as AnkiConnectClient
  );
  return { factory, findCards, getDeckStats };
};

describe('GetReviewQueueUseCase', () => {
  it('serves due + learning cards first, then new cards up to the daily limit', async () => {
    const { factory, findCards, getDeckStats } = factoryFor({
      due: [9001, 9002],
      fresh: [7001, 7002, 7003],
      newCount: 2,
    });
    const useCase = new GetReviewQueueUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, deck: 'My Own Deck' });

    expect(findCards).toHaveBeenCalledWith('deck:"My Own Deck" is:due');
    expect(findCards).toHaveBeenCalledWith(
      'deck:"My Own Deck" is:new -is:suspended -is:buried'
    );
    expect(getDeckStats).toHaveBeenCalledWith(['My Own Deck']);
    expect(result).toEqual({
      connected: true,
      cardIds: [9001, 9002, 7001, 7002],
    });
  });

  it('serves no new cards when the daily new allotment is exhausted', async () => {
    const { factory } = factoryFor({
      due: [9001],
      fresh: [7001, 7002],
      newCount: 0,
    });
    const useCase = new GetReviewQueueUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, deck: 'Deck' });

    expect(result).toEqual({ connected: true, cardIds: [9001] });
  });

  it('serves a new-only deck when nothing is due', async () => {
    const { factory } = factoryFor({
      due: [],
      fresh: [7001, 7002, 7003],
      newCount: 5,
    });
    const useCase = new GetReviewQueueUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, deck: 'Deck' });

    expect(result).toEqual({ connected: true, cardIds: [7001, 7002, 7003] });
  });

  it('returns connected:false when no active client', async () => {
    const useCase = new GetReviewQueueUseCase(clientsRepo(null), vi.fn());

    const result = await useCase.execute({
      owner: 42,
      deck: 'Notion Sync::Pharma',
    });

    expect(result).toEqual({ connected: false });
  });

  it('returns an empty card id list when nothing is due or new', async () => {
    const { factory } = factoryFor({ due: [], fresh: [], newCount: 0 });
    const useCase = new GetReviewQueueUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({
      owner: 42,
      deck: 'Notion Sync::Pharma',
    });

    expect(result).toEqual({ connected: true, cardIds: [] });
  });

  it('escapes quotes and backslashes in the deck name', async () => {
    const { factory, findCards } = factoryFor({ newCount: 0 });
    const useCase = new GetReviewQueueUseCase(
      clientsRepo(activeClient),
      factory
    );

    await useCase.execute({ owner: 42, deck: 'Week "18"\\x' });

    expect(findCards).toHaveBeenCalledWith('deck:"Week \\"18\\"\\\\x" is:due');
    expect(findCards).toHaveBeenCalledWith(
      'deck:"Week \\"18\\"\\\\x" is:new -is:suspended -is:buried'
    );
  });
});
