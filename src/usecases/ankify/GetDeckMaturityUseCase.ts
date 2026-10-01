import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { userOwnsDeck } from '../../lib/ankify/deckOwnership';
import { AnkiConnectFactory } from './GetAnkifyStatsUseCase';
import { DeckNotOwnedError } from './OpenDeckInAnkiUseCase';
import type {
  DeckMaturityConnected,
  DeckMaturityOffline,
  DeckMaturityResult,
} from '../../types/ankify/DeckMaturity';

export type {
  DeckMaturityConnected,
  DeckMaturityOffline,
  DeckMaturityResult,
};

const MATURE_INTERVAL_DAYS = 21;

const escapeDeckQueryValue = (deck: string): string =>
  deck.split('\\').join('\\\\').split('"').join('\\"');

export interface GetDeckMaturityInput {
  owner: number;
  deck: string;
  ankiConnectHost?: string;
}

export class GetDeckMaturityUseCase {
  constructor(
    private readonly clients: AnkifyClientsRepositoryInterface,
    private readonly subscriptions: AnkifyNotionSubscriptionsRepositoryInterface,
    private readonly ankiConnect: AnkiConnectFactory
  ) {}

  async execute(input: GetDeckMaturityInput): Promise<DeckMaturityResult> {
    const owned = await this.subscriptions.listByOwner(input.owner);
    if (!userOwnsDeck(input.deck, owned)) {
      throw new DeckNotOwnedError();
    }

    const client = await this.clients.findActiveByOwner(input.owner);
    if (client == null) {
      return { connected: false };
    }

    const ac = this.ankiConnect(
      input.ankiConnectHost ?? 'localhost',
      client.anki_port,
      client.anki_connect_api_key
    );

    await ac.ping();

    const query = `deck:"${escapeDeckQueryValue(input.deck)}" -is:new`;
    const cards = await ac.findCards(query);
    if (cards.length === 0) {
      return { connected: true, matureCount: 0, total: 0, avgIntervalDays: 0 };
    }

    const intervals = await ac.getIntervals(cards);
    const matureCount = intervals.filter(
      (interval) => interval >= MATURE_INTERVAL_DAYS
    ).length;
    const intervalSum = intervals.reduce((sum, interval) => sum + interval, 0);
    const avgIntervalDays =
      intervals.length > 0
        ? Math.round((intervalSum / intervals.length) * 10) / 10
        : 0;

    return {
      connected: true,
      matureCount,
      total: intervals.length,
      avgIntervalDays,
    };
  }
}
