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
      claimKey: storageKey,
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

  it('deletes expired and long-claimed holds and their objects, keeps the rest', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seed(repo, 'held/expired.html', hourAgo, null);
    await seed(repo, 'held/long-claimed.html', soon, twoDaysAgo);
    await seed(repo, 'held/active.html', soon, null);
    await seed(repo, 'held/just-claimed.html', soon, hourAgo);

    const deleted: string[] = [];
    const storage = {
      delete: jest.fn(async (key: string) => {
        deleted.push(key);
        return true;
      }),
    } as unknown as StorageHandler;

    await deleteExpiredHeldDecks(
      undefined as never,
      storage,
      now,
      repo
    );

    expect(deleted.sort()).toEqual([
      'held/expired.html',
      'held/long-claimed.html',
    ]);
    expect(repo.rows.map((r) => r.storage_key).sort()).toEqual([
      'held/active.html',
      'held/just-claimed.html',
    ]);
  });
});
