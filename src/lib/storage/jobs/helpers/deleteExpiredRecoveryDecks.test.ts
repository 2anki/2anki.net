import { ANON_RECOVERY_RETENTION_MS } from '../../../upload/anonymousRecovery';
import {
  deleteExpiredRecoveryDecks,
  type RecoveryDeckStore,
} from './deleteExpiredRecoveryDecks';

const now = new Date('2026-10-01T03:00:00.000Z');
const expired = new Date(now.getTime() - ANON_RECOVERY_RETENTION_MS - 1000);
const fresh = new Date(now.getTime() - 60 * 60 * 1000);

function storeWith(objects: { Key: string; LastModified?: Date }[]) {
  const deleted: string[][] = [];
  const store: RecoveryDeckStore = {
    listObjectsByPrefix: jest.fn(async () => objects),
    deleteObjects: jest.fn(async (keys: string[]) => {
      deleted.push(keys);
    }),
  };
  return { store, deleted };
}

describe('deleteExpiredRecoveryDecks', () => {
  it('lists only the recovery prefix', async () => {
    const { store } = storeWith([]);
    await deleteExpiredRecoveryDecks(store, now);
    expect(store.listObjectsByPrefix).toHaveBeenCalledWith('recover/');
  });

  it('deletes decks older than the retention window and keeps fresh ones', async () => {
    const { store, deleted } = storeWith([
      { Key: 'recover/old.apkg', LastModified: expired },
      { Key: 'recover/new.apkg', LastModified: fresh },
    ]);
    await expect(deleteExpiredRecoveryDecks(store, now)).resolves.toBe(1);
    expect(deleted).toEqual([['recover/old.apkg']]);
  });

  it('leaves an object with no modification time alone', async () => {
    const { store, deleted } = storeWith([{ Key: 'recover/unknown.apkg' }]);
    await expect(deleteExpiredRecoveryDecks(store, now)).resolves.toBe(0);
    expect(deleted).toEqual([]);
  });

  it('deletes in batches of at most 1000 keys', async () => {
    const objects = Array.from({ length: 1001 }, (_, i) => ({
      Key: `recover/${i}.apkg`,
      LastModified: expired,
    }));
    const { store, deleted } = storeWith(objects);
    await expect(deleteExpiredRecoveryDecks(store, now)).resolves.toBe(1001);
    expect(deleted.map((batch) => batch.length)).toEqual([1000, 1]);
  });
});
