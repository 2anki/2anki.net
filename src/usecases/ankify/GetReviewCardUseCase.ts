import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkiConnectFactory } from './GetAnkifyStatsUseCase';
import { inlineReviewMedia } from './inlineReviewMedia';
import { REVIEW_MEDIA_CSS } from './reviewMediaCss';
import { buildCardExistsQuery } from './reviewQueries';
import type { ReviewCard } from '../../types/ankify/Review';

export type { ReviewCard };

export type GetReviewCardResult =
  | { connected: true; card: ReviewCard | null }
  | { connected: false; card: null };

export interface GetReviewCardInput {
  owner: number;
  cardId: number;
  ankiConnectHost?: string;
}

export class GetReviewCardUseCase {
  constructor(
    private readonly clients: AnkifyClientsRepositoryInterface,
    private readonly ankiConnect: AnkiConnectFactory
  ) {}

  async execute(input: GetReviewCardInput): Promise<GetReviewCardResult> {
    const client = await this.clients.findActiveByOwner(input.owner);
    if (client == null) {
      return { connected: false, card: null };
    }

    const ac = this.ankiConnect(
      input.ankiConnectHost ?? 'localhost',
      client.anki_port,
      client.anki_connect_api_key
    );

    await ac.ping();

    const matches = await ac.findCards(buildCardExistsQuery(input.cardId));
    if (!matches.includes(input.cardId)) {
      return { connected: true, card: null };
    }

    const info = await ac.cardsInfo([input.cardId]);
    const card = info[0];
    if (card == null) {
      return { connected: true, card: null };
    }

    const cache = new Map<string, string | null>();
    const fetchMedia = (filename: string) => ac.retrieveMediaFile(filename);

    const question = card.question ?? '';
    const answer = card.answer ?? '';
    const noteSounds = await this.collectNoteSounds(ac, card.note, [
      question,
      answer,
    ]);

    return {
      connected: true,
      card: {
        cardId: card.cardId,
        questionHtml: await inlineReviewMedia(
          question,
          fetchMedia,
          cache,
          noteSounds
        ),
        answerHtml: await inlineReviewMedia(
          answer,
          fetchMedia,
          cache,
          noteSounds
        ),
        css: (card.css ?? '') + REVIEW_MEDIA_CSS,
      },
    };
  }

  private async collectNoteSounds(
    ac: ReturnType<AnkiConnectFactory>,
    noteId: number,
    sides: string[]
  ): Promise<string[]> {
    const hasPlayDirective = sides.some((side) => side.includes('[anki:play:'));
    if (!hasPlayDirective) {
      return [];
    }

    const notes = await ac.notesInfo([noteId]);
    const note = notes[0];
    if (note == null) {
      return [];
    }

    return Object.values(note.fields)
      .sort((a, b) => a.order - b.order)
      .flatMap((field) => [...field.value.matchAll(/\[sound:([^\]]+)\]/g)])
      .map((match) => match[1]);
  }
}
