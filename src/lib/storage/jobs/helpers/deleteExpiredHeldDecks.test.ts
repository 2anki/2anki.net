import { vi } from 'vitest';
import { InMemoryHeldDeckRepository } from '../../../../data_layer/HeldDeckRepository';
import StorageHandler from '../../StorageHandler';
import { deleteExpiredHeldDecks } from './deleteExpiredHeldDecks';

const now = new Date('2026-09-29T12:00:00.000Z');
const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
const soon = new Date(now.getTime() + 60 * 60 * 1000);

describe('deleteExpiredHeldDecks', () => {
  async function seed(
    repo: InMemoryHeldDeckRepository,
    storageKey: string,
    expiresAt: Date,
    claimedAt: Date | null
  ) {
    const row = await repo.insert({
      storageKey,
      anonId: 'anon',
      filename: 'notes.html',
      cardCount: 21,
      cardsHeldBack: 13,
      expiresAt,
    });
    if (claimedAt != null) {
      await repo.markClaimed(row.id, 1, claimedAt);
    }
  }

  function storageThatDeletes(
    outcome: (key: string) => boolean,
    deleted: string[]
  ): StorageHandler {
    return {
      delete: vi.fn(async (key: string) => {
        deleted.push(key);
        return outcome(key);
      }),
    } as unknown as StorageHandler;
  }

  it('deletes expired and long-claimed holds and their objects, keeps the rest', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seed(repo, 'held/expired', hourAgo, null);
    await seed(repo, 'held/long-claimed', soon, twoDaysAgo);
    await seed(repo, 'held/active', soon, null);
    await seed(repo, 'held/just-claimed', soon, hourAgo);
    const deleted: string[] = [];

    await deleteExpiredHeldDecks(
      undefined as never,
      storageThatDeletes(() => true, deleted),
      now,
      repo
    );

    expect(deleted.sort()).toEqual(['held/expired', 'held/long-claimed']);
    expect(repo.rows.map((r) => r.storage_key).sort()).toEqual([
      'held/active',
      'held/just-claimed',
    ]);
  });

  it('keeps the row when its object could not be deleted so the next pass retries', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seed(repo, 'held/expired-stuck', hourAgo, null);
    await seed(repo, 'held/expired-gone', hourAgo, null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await deleteExpiredHeldDecks(
      undefined as never,
      storageThatDeletes((key) => key !== 'held/expired-stuck', []),
      now,
      repo
    );

    expect(repo.rows.map((r) => r.storage_key)).toEqual(['held/expired-stuck']);
    expect(warn).toHaveBeenCalledWith(
      '[cleanup] held deck objects left for the next pass',
      { failed: 1 }
    );
    warn.mockRestore();
  });
});
