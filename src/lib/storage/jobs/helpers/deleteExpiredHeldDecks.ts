import { Knex } from 'knex';

import StorageHandler from '../../StorageHandler';
import {
  HeldDeckRepository,
  type IHeldDeckRepository,
} from '../../../../data_layer/HeldDeckRepository';

const CLAIMED_RETENTION_MS = 24 * 60 * 60 * 1000;

// Unclaimed holds live until their expires_at; a claimed hold's source file is
// no longer needed once the deck has been converted, so it is swept a day after
// the claim. The stored object goes first and the row only follows a confirmed
// delete, so a failed object delete keeps its row and is retried next pass
// instead of orphaning the object under the reserved held/ prefix.
export const deleteExpiredHeldDecks = async (
  db: Knex,
  storage: StorageHandler,
  now: Date = new Date(),
  repository: IHeldDeckRepository = new HeldDeckRepository(db)
): Promise<void> => {
  const claimedBefore = new Date(now.getTime() - CLAIMED_RETENTION_MS);
  const expired = await repository.findExpired(now, claimedBefore);
  const removed: number[] = [];
  let failed = 0;
  for (const hold of expired) {
    if (await storage.delete(hold.storageKey)) {
      removed.push(hold.id);
    } else {
      failed += 1;
    }
  }
  await repository.deleteByIds(removed);
  if (failed > 0) {
    console.warn('[cleanup] held deck objects left for the next pass', {
      failed,
    });
  }
};

export default deleteExpiredHeldDecks;
