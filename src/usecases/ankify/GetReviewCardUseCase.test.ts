import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { GetReviewCardUseCase } from './GetReviewCardUseCase';

const REVIEW_MEDIA_CSS_MARKER = '.n2a-review-missing{';

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

describe('GetReviewCardUseCase', () => {
  it('returns connected:false when no active client', async () => {
    const useCase = new GetReviewCardUseCase(clientsRepo(null), vi.fn());

    const result = await useCase.execute({ owner: 42, cardId: 9001 });

    expect(result).toEqual({ connected: false, card: null });
  });

  it('returns card:null when the card id is not in this Anki', async () => {
    const findCards = vi.fn(async () => []);
    const cardsInfo = vi.fn();
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          cardsInfo,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, cardId: 9001 });

    expect(findCards).toHaveBeenCalledWith('cid:9001');
    expect(result).toEqual({ connected: true, card: null });
    expect(cardsInfo).not.toHaveBeenCalled();
  });

  it('returns the card with the review media css appended', async () => {
    const findCards = vi.fn(async () => [9001]);
    const cardsInfo = vi.fn(async () => [
      {
        cardId: 9001,
        note: 5,
        deckName: 'Notion Sync::Pharma',
        lapses: 0,
        queue: 2,
        question: '<p>Q1</p>',
        answer: '<p>A1</p>',
        css: '.card { color: black; }',
      },
    ]);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          cardsInfo,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, cardId: 9001 });

    expect(result.connected).toBe(true);
    expect(result.card).toMatchObject({
      cardId: 9001,
      questionHtml: '<p>Q1</p>',
      answerHtml: '<p>A1</p>',
    });
    expect(result.card?.css).toContain('.card { color: black; }');
    expect(result.card?.css).toContain(REVIEW_MEDIA_CSS_MARKER);
  });

  it('inlines image and audio media as data URIs and strips raw tokens', async () => {
    const findCards = vi.fn(async () => [9001]);
    const cardsInfo = vi.fn(async () => [
      {
        cardId: 9001,
        note: 5,
        deckName: 'Notion Sync::JP',
        lapses: 0,
        queue: 2,
        question: '<img src="a.jpg">[anki:play:q:0]',
        answer: '[sound:b.mp3][anki:play:a:0]',
        css: '.card {}',
      },
    ]);
    const notesInfo = vi.fn(async () => [
      {
        noteId: 5,
        modelName: 'JlabNote-JlabConverted-1',
        tags: [],
        fields: { Audio: { value: '[sound:b.mp3]', order: 0 } },
      },
    ]);
    const retrieveMediaFile = vi.fn(async () =>
      Buffer.from('BYTES', 'utf-8').toString('base64')
    );
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          cardsInfo,
          notesInfo,
          retrieveMediaFile,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, cardId: 9001 });

    expect(result.card?.questionHtml).toContain('data:image/jpeg;base64,');
    expect(result.card?.questionHtml).toContain('<audio');
    expect(result.card?.answerHtml).toContain('<audio');
    expect(result.card?.answerHtml).toContain('data:audio/mpeg;base64,');
    expect(result.card?.questionHtml).not.toContain('[anki:play:');
    expect(result.card?.answerHtml).not.toContain('[sound:');
  });

  it('resolves [anki:play] directives to audio from the note field sounds', async () => {
    const findCards = vi.fn(async () => [9001]);
    const cardsInfo = vi.fn(async () => [
      {
        cardId: 9001,
        note: 77,
        deckName: 'Notion Sync::JP',
        lapses: 0,
        queue: 2,
        question: '日本語 [anki:play:q:0]',
        answer: 'translation',
        css: '.card {}',
      },
    ]);
    const notesInfo = vi.fn(async () => [
      {
        noteId: 77,
        modelName: 'JlabNote-JlabConverted-1',
        tags: [],
        fields: {
          Expression: { value: '日本語', order: 0 },
          Audio: { value: '[sound:1600420050000.mp3]', order: 1 },
          Meaning: { value: 'Japanese', order: 2 },
        },
      },
    ]);
    const retrieveMediaFile = vi.fn(async () =>
      Buffer.from('MP3BYTES', 'utf-8').toString('base64')
    );
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          cardsInfo,
          notesInfo,
          retrieveMediaFile,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, cardId: 9001 });

    expect(notesInfo).toHaveBeenCalledWith([77]);
    expect(retrieveMediaFile).toHaveBeenCalledWith('1600420050000.mp3');
    expect(result.card?.questionHtml).toContain('<audio');
    expect(result.card?.questionHtml).toContain('data:audio/mpeg;base64,');
    expect(result.card?.questionHtml).not.toContain('[anki:play:');
  });

  it('does not fetch note info for a card without [anki:play] directives', async () => {
    const findCards = vi.fn(async () => [9001]);
    const cardsInfo = vi.fn(async () => [
      {
        cardId: 9001,
        note: 5,
        deckName: 'Notion Sync::Pharma',
        lapses: 0,
        queue: 2,
        question: '<p>Q1</p>',
        answer: '<p>A1</p>',
        css: '',
      },
    ]);
    const notesInfo = vi.fn();
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          cardsInfo,
          notesInfo,
          retrieveMediaFile: vi.fn(),
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    await useCase.execute({ owner: 42, cardId: 9001 });

    expect(notesInfo).not.toHaveBeenCalled();
  });

  it('fetches a media file shared across front and back only once', async () => {
    const findCards = vi.fn(async () => [9001]);
    const cardsInfo = vi.fn(async () => [
      {
        cardId: 9001,
        note: 5,
        deckName: 'Notion Sync::JP',
        lapses: 0,
        queue: 2,
        question: '<img src="shared.png">',
        answer: '<img src="shared.png">',
        css: '',
      },
    ]);
    const retrieveMediaFile = vi.fn(async () =>
      Buffer.from('BYTES', 'utf-8').toString('base64')
    );
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          cardsInfo,
          retrieveMediaFile,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GetReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    await useCase.execute({ owner: 42, cardId: 9001 });

    expect(retrieveMediaFile).toHaveBeenCalledTimes(1);
  });
});
