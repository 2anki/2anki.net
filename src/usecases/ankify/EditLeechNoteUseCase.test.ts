import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { EditLeechNoteUseCase } from './EditLeechNoteUseCase';
import { NoteNotOwnedError } from './assertNoteOwned';
import { NoActiveAnkifyClientForLeechError } from './leechClient';

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

describe('EditLeechNoteUseCase', () => {
  test('updates the note fields after the ownership check passes', async () => {
    const findNotes = vi.fn(async () => [7001]);
    const updateNoteFields = vi.fn(async () => null);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes,
          updateNoteFields,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new EditLeechNoteUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      factory
    );

    await useCase.execute({
      owner: 42,
      noteId: 7001,
      fields: { Front: 'new front' },
    });

    expect(findNotes).toHaveBeenCalledWith(
      'nid:7001 (deck:"Notion Sync::Pharma")'
    );
    expect(updateNoteFields).toHaveBeenCalledWith(7001, { Front: 'new front' });
  });

  test('rejects a note in an unowned deck and never mutates', async () => {
    const findNotes = vi.fn(async () => []);
    const updateNoteFields = vi.fn(async () => null);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findNotes,
          updateNoteFields,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new EditLeechNoteUseCase(
      clientsRepo(activeClient),
      subsRepo([
        { target_deck: 'Notion Sync::Torts', notion_page_title: null },
      ]),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, noteId: 9999, fields: { Front: 'x' } })
    ).rejects.toBeInstanceOf(NoteNotOwnedError);
    expect(updateNoteFields).not.toHaveBeenCalled();
  });

  test('throws when there is no active client', async () => {
    const useCase = new EditLeechNoteUseCase(
      clientsRepo(null),
      subsRepo([
        { target_deck: 'Notion Sync::Pharma', notion_page_title: null },
      ]),
      vi.fn()
    );

    await expect(
      useCase.execute({ owner: 42, noteId: 7001, fields: { Front: 'x' } })
    ).rejects.toBeInstanceOf(NoActiveAnkifyClientForLeechError);
  });
});
