import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { DeleteLeechNoteUseCase } from './DeleteLeechNoteUseCase';
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

describe('DeleteLeechNoteUseCase', () => {
  test('deletes the note after the ownership check passes', async () => {
    const deleteNotes = vi.fn(async () => null);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes: vi.fn(async () => [7001]),
          deleteNotes,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new DeleteLeechNoteUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    await useCase.execute({ owner: 42, noteId: 7001 });

    expect(deleteNotes).toHaveBeenCalledWith([7001]);
  });

  test('rejects a note in an unowned deck and never deletes', async () => {
    const deleteNotes = vi.fn(async () => null);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes: vi.fn(async () => []),
          deleteNotes,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new DeleteLeechNoteUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Torts', notion_page_title: null },
      ]),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, noteId: 9999 })
    ).rejects.toBeInstanceOf(NoteNotOwnedError);
    expect(deleteNotes).not.toHaveBeenCalled();
  });

  test('deleting an already-deleted note does not throw', async () => {
    const deleteNotes = vi.fn(async () => null);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes: vi.fn(async () => [7001]),
          deleteNotes,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new DeleteLeechNoteUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, noteId: 7001 })
    ).resolves.toBeUndefined();
  });
});
