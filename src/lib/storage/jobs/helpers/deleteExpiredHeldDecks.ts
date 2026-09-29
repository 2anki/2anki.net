import { Knex } from 'knex';

import StorageHandler from '../../StorageHandler';
import {
  HeldDeckRepository,
  type IHeldDeckRepository,
} from '../../../../data_layer/HeldDeckRepository';

const CLAIMED_RETENTION_MS = 24 * 60 * 60 * 1000;

// Unclaimed holds live 24h (their expires_at); a claimed hold's source file is
// no longer needed once the deck has been converted, so it is swept a day after
// the claim. Both cases delete the row and its stored source object so the
// held/ prefix never accumulates.
export const deleteExpiredHeldDecks = async (
  db: Knex,
  storage: StorageHandler,
  now: Date = new Date(),
  repository: IHeldDeckRepository = new HeldDeckRepository(db)
): Promise<void> => {
  const claimedBefore = new Date(now.getTime() - CLAIMED_RETENTION_MS);
  const storageKeys = await repository.deleteExpired(now, claimedBefore);
  for (const key of storageKeys) {
    await storage.delete(key);
  }
};

export default deleteExpiredHeldDecks;
