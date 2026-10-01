import {
  ANON_RECOVERY_PREFIX,
  ANON_RECOVERY_RETENTION_MS,
} from '../../../upload/anonymousRecovery';

export interface RecoveryDeckStore {
  listObjectsByPrefix(
    prefix: string
  ): Promise<{ Key: string; LastModified?: Date }[]>;
  deleteObjects(keys: string[]): Promise<void>;
}

const DELETE_BATCH_SIZE = 1000;

// recover/ is reserved from the dangling-object walk, so this is the only
// thing that ever removes an anonymous recovery deck.
export const deleteExpiredRecoveryDecks = async (
  store: RecoveryDeckStore,
  now: Date = new Date()
): Promise<number> => {
  const cutoff = now.getTime() - ANON_RECOVERY_RETENTION_MS;
  const objects = await store.listObjectsByPrefix(ANON_RECOVERY_PREFIX);
  const expiredKeys = objects
    .filter(
      (obj) => obj.LastModified != null && obj.LastModified.getTime() < cutoff
    )
    .map((obj) => obj.Key);
  for (let start = 0; start < expiredKeys.length; start += DELETE_BATCH_SIZE) {
    await store.deleteObjects(
      expiredKeys.slice(start, start + DELETE_BATCH_SIZE)
    );
  }
  return expiredKeys.length;
};

export default deleteExpiredRecoveryDecks;
