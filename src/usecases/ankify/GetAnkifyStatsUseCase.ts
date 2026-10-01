import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import {
  AnkiConnectClient,
  AnkiConnectUnreachableError,
  AnkiDeckStat,
} from '../../services/ankify/AnkiConnectClient';
import { computeReviewStreaks } from './ankifyStreak';
import type {
  AnkifyStatsConnected,
  AnkifyStatsDeck,
  AnkifyStatsOffline,
  AnkifyStatsResult,
  AnkifyStatsReviewDay,
} from '../../types/ankify/AnkifyStats';

export type {
  AnkifyStatsConnected,
  AnkifyStatsDeck,
  AnkifyStatsOffline,
  AnkifyStatsResult,
  AnkifyStatsReviewDay,
};

export type AnkiConnectFactory = (
  host: string,
  port: number,
  apiKey: string | null
) => AnkiConnectClient;

const leafName = (fullName: string): string => {
  const segments = fullName.split('::');
  return segments[segments.length - 1];
};

const deckDepth = (fullName: string): number => fullName.split('::').length - 1;

const oneYearAgo = (today: string): string => {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return cutoff.toISOString().slice(0, 10);
};

export class GetAnkifyStatsUseCase {
  constructor(
    private readonly clients: AnkifyClientsRepositoryInterface,
    private readonly ankiConnect: AnkiConnectFactory
  ) {}

  async execute(
    owner: number,
    options: { today: string; ankiConnectHost?: string }
  ): Promise<AnkifyStatsResult> {
    const client = await this.clients.findActiveByOwner(owner);
    if (client == null) {
      return { connected: false };
    }

    const ac = this.ankiConnect(
      options.ankiConnectHost ?? 'localhost',
      client.anki_port,
      client.anki_connect_api_key
    );

    try {
      await ac.ping();
    } catch (error) {
      if (error instanceof AnkiConnectUnreachableError) {
        return { connected: false };
      }
      throw error;
    }

    const deckNamesAndIds = await ac.deckNamesAndIds();
    const deckNames = Object.keys(deckNamesAndIds);
    const fullNameById = new Map<number, string>();
    for (const [fullName, id] of Object.entries(deckNamesAndIds)) {
      fullNameById.set(id, fullName);
    }

    const [reviewedToday, reviewsByDayRaw, deckStats] = await Promise.all([
      ac.getNumCardsReviewedToday(),
      ac.getNumCardsReviewedByDay(),
      deckNames.length > 0
        ? ac.getDeckStats(deckNames)
        : Promise.resolve<Record<string, AnkiDeckStat>>({}),
    ]);

    const reviewsByDay = reviewsByDayRaw.map(([date, count]) => ({
      date,
      count,
    }));
    const { currentStreak, longestStreak } = computeReviewStreaks(
      reviewsByDayRaw,
      options.today
    );
    const yearCutoff = oneYearAgo(options.today);
    const reviewedThisYear = reviewsByDay
      .filter((entry) => entry.date >= yearCutoff)
      .reduce((sum, entry) => sum + entry.count, 0);

    const decks: AnkifyStatsDeck[] = Object.values(deckStats)
      .map((stat) => {
        const fullName = fullNameById.get(stat.deck_id) ?? stat.name;
        return {
          fullName,
          name: leafName(fullName),
          depth: deckDepth(fullName),
          new: stat.new_count,
          learning: stat.learn_count,
          review: stat.review_count,
          total: stat.total_in_deck ?? 0,
        };
      })
      .sort((a, b) =>
        b.total === a.total ? a.name.localeCompare(b.name) : b.total - a.total
      );

    return {
      connected: true,
      reviewedToday,
      reviewedThisYear,
      currentStreak,
      longestStreak,
      reviewsByDay,
      decks,
    };
  }
}
