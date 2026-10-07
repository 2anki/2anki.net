import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { ReturnLeechToReviewUseCase } from './ReturnLeechToReviewUseCase';
import { NoteNotOwnedError } from './assertNoteOwned';

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

describe('ReturnLeechToReviewUseCase', () => {
  test('unsuspends the cards and drops the leech tag', async () => {
    const unsuspend = vi.fn(async () => true);
    const removeTags = vi.fn(async () => null);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes: vi.fn(async () => [7001]),
          notesInfo: vi.fn(async () => [
            {
              noteId: 7001,
              modelName: 'Basic',
              tags: ['leech'],
              fields: {},
              cards: [11, 12],
            },
          ]),
          unsuspend,
          removeTags,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ReturnLeechToReviewUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    const result = await useCase.execute({ owner: 42, noteId: 7001 });

    expect(unsuspend).toHaveBeenCalledWith([11, 12]);
    expect(removeTags).toHaveBeenCalledWith([7001], 'leech');
    expect(result).toEqual({
      noteId: 7001,
      unsuspended: true,
      tagRemoved: true,
    });
  });

  test('unsuspend returning false still counts as success', async () => {
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes: vi.fn(async () => [7001]),
          notesInfo: vi.fn(async () => [
            {
              noteId: 7001,
              modelName: 'Basic',
              tags: ['leech'],
              fields: {},
              cards: [11],
            },
          ]),
          unsuspend: vi.fn(async () => false),
          removeTags: vi.fn(async () => null),
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ReturnLeechToReviewUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    const result = await useCase.execute({ owner: 42, noteId: 7001 });

    expect(result).toEqual({
      noteId: 7001,
      unsuspended: false,
      tagRemoved: true,
    });
  });

  test('rejects a note in an unowned deck and never mutates', async () => {
    const unsuspend = vi.fn(async () => true);
    const removeTags = vi.fn(async () => null);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes: vi.fn(async () => []),
          notesInfo: vi.fn(),
          unsuspend,
          removeTags,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new ReturnLeechToReviewUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Torts', notion_page_title: null },
      ]),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, noteId: 9999 })
    ).rejects.toBeInstanceOf(NoteNotOwnedError);
    expect(unsuspend).not.toHaveBeenCalled();
    expect(removeTags).not.toHaveBeenCalled();
  });
});
