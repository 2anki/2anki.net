import { vi, type Mock } from 'vitest';
import { GetAnkifyStatsUseCase } from './GetAnkifyStatsUseCase';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import {
  AnkiConnectUnreachableError,
  AnkiDeckStat,
} from '../../services/ankify/AnkiConnectClient';
import { AnkifyClient } from '../../entities/ankify';

const activeClient = {
  id: 7,
  anki_port: 8765,
  anki_connect_api_key: null,
} as unknown as AnkifyClient;

const makeClientsRepo = (
  client: AnkifyClient | null
): AnkifyClientsRepositoryInterface =>
  ({
    findActiveByOwner: vi.fn(async () => client),
  }) as unknown as AnkifyClientsRepositoryInterface;

const TODAY = '2026-06-12';

interface FakeAnkiConnect {
  ping: Mock;
  deckNames: Mock;
  deckNamesAndIds: Mock;
  getNumCardsReviewedToday: Mock;
  getNumCardsReviewedByDay: Mock;
  getDeckStats: Mock;
  cardReviews: Mock;
  getReviewMinutesByDay: Mock;
}

const makeAnkiConnect = (
  overrides: Partial<Record<keyof FakeAnkiConnect, Mock>> = {}
): FakeAnkiConnect => ({
  ping: vi.fn(async () => 6),
  deckNames: vi.fn(async () => [] as string[]),
  deckNamesAndIds: vi.fn(async () => ({}) as Record<string, number>),
  getNumCardsReviewedToday: vi.fn(async () => 0),
  getNumCardsReviewedByDay: vi.fn(async () => [] as Array<[string, number]>),
  getDeckStats: vi.fn(async () => ({}) as Record<string, AnkiDeckStat>),
  cardReviews: vi.fn(async () => []),
  getReviewMinutesByDay: vi.fn(async () => new Map()),
  ...overrides,
});

describe('GetAnkifyStatsUseCase', () => {
  test('returns connected:false when there is no active client', async () => {
    const ac = makeAnkiConnect();
    const useCase = new GetAnkifyStatsUseCase(
      makeClientsRepo(null),
      () => ac as never
    );

    const result = await useCase.execute(1, { today: TODAY });

    expect(result).toEqual({ connected: false });
    expect(ac.getNumCardsReviewedToday).not.toHaveBeenCalled();
  });

  test('returns connected:false when the client is unreachable', async () => {
    const ac = makeAnkiConnect({
      ping: vi.fn(async () => {
        throw new AnkiConnectUnreachableError('http://x', new Error('down'));
      }),
    });
    const useCase = new GetAnkifyStatsUseCase(
      makeClientsRepo(activeClient),
      () => ac as never
    );

    const result = await useCase.execute(1, { today: TODAY });

    expect(result).toEqual({ connected: false });
    expect(ac.getNumCardsReviewedToday).not.toHaveBeenCalled();
    expect(ac.getDeckStats).not.toHaveBeenCalled();
  });

  test('skips getDeckStats when the collection has no decks', async () => {
    const ac = makeAnkiConnect({
      deckNames: vi.fn(async () => []),
      getNumCardsReviewedToday: vi.fn(async () => 4),
      getNumCardsReviewedByDay: vi.fn(async () => [['2026-06-12', 4]]),
    });
    const useCase = new GetAnkifyStatsUseCase(
      makeClientsRepo(activeClient),
      () => ac as never
    );

    const result = await useCase.execute(1, { today: TODAY });

    expect(ac.getDeckStats).not.toHaveBeenCalled();
    expect(result).toEqual({
      connected: true,
      reviewedToday: 4,
      reviewedThisYear: 4,
      currentStreak: 1,
      longestStreak: 1,
      reviewsByDay: [{ date: '2026-06-12', count: 4 }],
      decks: [],
    });
  });

  test('recovers full deck paths from deckNamesAndIds and sorts decks by total desc', async () => {
    const ac = makeAnkiConnect({
      deckNamesAndIds: vi.fn(async () => ({
        Default: 1,
        Pharmacology: 111,
        'Spanish::Verbs': 222,
      })),
      getNumCardsReviewedToday: vi.fn(async () => 12),
      getNumCardsReviewedByDay: vi.fn(async () => [
        ['2026-06-12', 12],
        ['2026-06-11', 8],
      ]),
      getDeckStats: vi.fn(async () => ({
        '1': {
          deck_id: 1,
          name: 'Default',
          new_count: 0,
          learn_count: 0,
          review_count: 0,
          total_in_deck: 0,
        },
        '111': {
          deck_id: 111,
          name: 'Pharmacology',
          new_count: 5,
          learn_count: 2,
          review_count: 11,
          total_in_deck: 120,
        },
        '222': {
          deck_id: 222,
          name: 'Verbs',
          new_count: 1,
          learn_count: 0,
          review_count: 4,
          total_in_deck: 300,
        },
      })),
    });
    const useCase = new GetAnkifyStatsUseCase(
      makeClientsRepo(activeClient),
      () => ac as never
    );

    const result = await useCase.execute(1, { today: TODAY });

    expect(ac.deckNamesAndIds).toHaveBeenCalledTimes(1);
    expect(ac.deckNames).not.toHaveBeenCalled();
    expect(ac.getDeckStats).toHaveBeenCalledWith([
      'Default',
      'Pharmacology',
      'Spanish::Verbs',
    ]);
    expect(ac.cardReviews).not.toHaveBeenCalled();
    expect(ac.getReviewMinutesByDay).not.toHaveBeenCalled();
    expect(result).toEqual({
      connected: true,
      reviewedToday: 12,
      reviewedThisYear: 20,
      currentStreak: 2,
      longestStreak: 2,
      reviewsByDay: [
        { date: '2026-06-12', count: 12 },
        { date: '2026-06-11', count: 8 },
      ],
      decks: [
        {
          fullName: 'Spanish::Verbs',
          name: 'Verbs',
          depth: 1,
          new: 1,
          learning: 0,
          review: 4,
          total: 300,
        },
        {
          fullName: 'Pharmacology',
          name: 'Pharmacology',
          depth: 0,
          new: 5,
          learning: 2,
          review: 11,
          total: 120,
        },
        {
          fullName: 'Default',
          name: 'Default',
          depth: 0,
          new: 0,
          learning: 0,
          review: 0,
          total: 0,
        },
      ],
    });
  });

  test('recovers the full path for a database-child subdeck whose stats name is the leaf', async () => {
    const ac = makeAnkiConnect({
      deckNamesAndIds: vi.fn(async () => ({
        "Jlab's beginner course": 100,
        "Jlab's beginner course::Part 1: Listening comprehension": 200,
      })),
      getDeckStats: vi.fn(async () => ({
        '200': {
          deck_id: 200,
          name: 'Part 1: Listening comprehension',
          new_count: 2,
          learn_count: 1,
          review_count: 7,
          total_in_deck: 40,
        },
      })),
    });
    const useCase = new GetAnkifyStatsUseCase(
      makeClientsRepo(activeClient),
      () => ac as never
    );

    const result = await useCase.execute(1, { today: TODAY });

    expect(result).toMatchObject({
      connected: true,
      decks: [
        {
          fullName: "Jlab's beginner course::Part 1: Listening comprehension",
          name: 'Part 1: Listening comprehension',
          depth: 1,
          new: 2,
          learning: 1,
          review: 7,
          total: 40,
        },
      ],
    });
  });

  test('falls back to the stat name when the deck_id is absent from the names map', async () => {
    const ac = makeAnkiConnect({
      deckNamesAndIds: vi.fn(async () => ({ Anatomy: 2 })),
      getDeckStats: vi.fn(async () => ({
        '999': {
          deck_id: 999,
          name: 'Orphan::Leaf',
          new_count: 0,
          learn_count: 0,
          review_count: 1,
          total_in_deck: 5,
        },
      })),
    });
    const useCase = new GetAnkifyStatsUseCase(
      makeClientsRepo(activeClient),
      () => ac as never
    );

    const result = await useCase.execute(1, { today: TODAY });

    expect(result).toMatchObject({
      connected: true,
      decks: [
        {
          fullName: 'Orphan::Leaf',
          name: 'Leaf',
          depth: 1,
          review: 1,
          total: 5,
        },
      ],
    });
  });

  test('tie-breaks decks with equal totals by name ascending', async () => {
    const ac = makeAnkiConnect({
      deckNamesAndIds: vi.fn(async () => ({ Zoology: 1, Anatomy: 2 })),
      getDeckStats: vi.fn(async () => ({
        '1': {
          deck_id: 1,
          name: 'Zoology',
          new_count: 0,
          learn_count: 0,
          review_count: 0,
          total_in_deck: 50,
        },
        '2': {
          deck_id: 2,
          name: 'Anatomy',
          new_count: 0,
          learn_count: 0,
          review_count: 0,
          total_in_deck: 50,
        },
      })),
    });
    const useCase = new GetAnkifyStatsUseCase(
      makeClientsRepo(activeClient),
      () => ac as never
    );

    const result = await useCase.execute(1, { today: TODAY });

    expect(result).toMatchObject({
      connected: true,
      decks: [
        { name: 'Anatomy', total: 50 },
        { name: 'Zoology', total: 50 },
      ],
    });
  });
});
