import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { ownedDeckNames } from '../../lib/ankify/deckOwnership';
import {
  AnkiCardInfo,
  AnkiConnectUnreachableError,
  AnkiNoteInfo,
} from '../../services/ankify/AnkiConnectClient';
import { AnkiConnectFactory } from './GetAnkifyStatsUseCase';
import { buildLeechListQuery } from './leechQueries';
import type {
  LeechNote,
  LeechNoteField,
  ListLeechesConnected,
  ListLeechesOffline,
  ListLeechesResult,
} from '../../types/ankify/Leeches';

export type {
  LeechNote,
  LeechNoteField,
  ListLeechesConnected,
  ListLeechesOffline,
  ListLeechesResult,
};

const SUSPENDED_QUEUE = -1;

export interface ListLeechesInput {
  owner: number;
  ankiConnectHost?: string;
}

const orderedFields = (note: AnkiNoteInfo): LeechNoteField[] =>
  Object.entries(note.fields)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name, field]) => ({ name, value: field.value }));

export class ListLeechesUseCase {
  constructor(
    private readonly clients: AnkifyClientsRepositoryInterface,
    private readonly subscriptions: AnkifyNotionSubscriptionsRepositoryInterface,
    private readonly ankiConnect: AnkiConnectFactory
  ) {}

  async execute(input: ListLeechesInput): Promise<ListLeechesResult> {
    const owned = await this.subscriptions.listByOwner(input.owner);
    const decks = ownedDeckNames(owned);
    const query = buildLeechListQuery(decks);
    if (query == null) {
      return { connected: true, leeches: [] };
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

    try {
      await ac.ping();

      const noteIds = await ac.findNotes(query);
      if (noteIds.length === 0) {
        return { connected: true, leeches: [] };
      }

      const notes = await ac.notesInfo(noteIds);
      const cardIds = notes.flatMap((note) => note.cards ?? []);
      const cards = cardIds.length > 0 ? await ac.cardsInfo(cardIds) : [];
      const cardById = new Map<number, AnkiCardInfo>(
        cards.map((card) => [card.cardId, card])
      );

      const leeches = notes
        .map((note) => this.toLeechNote(note, cardById))
        .sort((a, b) => b.lapses - a.lapses);

      return { connected: true, leeches };
    } catch (error) {
      if (error instanceof AnkiConnectUnreachableError) {
        return { connected: false };
      }
      throw error;
    }
  }

  private toLeechNote(
    note: AnkiNoteInfo,
    cardById: Map<number, AnkiCardInfo>
  ): LeechNote {
    const firstCardId = (note.cards ?? [])[0];
    const card = firstCardId == null ? undefined : cardById.get(firstCardId);
    return {
      noteId: note.noteId,
      deckName: card?.deckName ?? '',
      modelName: note.modelName,
      fields: orderedFields(note),
      tags: note.tags,
      lapses: card?.lapses ?? 0,
      suspended: card?.queue === SUSPENDED_QUEUE,
    };
  }
}
