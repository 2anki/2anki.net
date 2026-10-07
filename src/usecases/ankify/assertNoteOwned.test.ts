import { vi, type Mock } from 'vitest';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import { assertNoteOwned, NoteNotOwnedError } from './assertNoteOwned';

const clientWith = (findNotes: Mock): AnkiConnectClient =>
  ({ findNotes }) as unknown as AnkiConnectClient;

describe('assertNoteOwned', () => {
  it('passes when the note resolves inside an owned deck', async () => {
    const findNotes = vi.fn(async () => [7001]);
    const ac = clientWith(findNotes);

    await assertNoteOwned(ac, ['Notion Sync::Pharma'], 7001);

    expect(findNotes).toHaveBeenCalledWith(
      'nid:7001 (deck:"Notion Sync::Pharma")'
    );
  });

  it('throws NoteNotOwnedError when the scoped query returns no match', async () => {
    const findNotes = vi.fn(async () => []);
    const ac = clientWith(findNotes);

    await expect(
      assertNoteOwned(ac, ['Notion Sync::Pharma'], 9999)
    ).rejects.toBeInstanceOf(NoteNotOwnedError);
  });

  it('throws NoteNotOwnedError without querying when the user owns no decks', async () => {
    const findNotes = vi.fn(async () => [7001]);
    const ac = clientWith(findNotes);

    await expect(assertNoteOwned(ac, [], 7001)).rejects.toBeInstanceOf(
      NoteNotOwnedError
    );
    expect(findNotes).not.toHaveBeenCalled();
  });
});
