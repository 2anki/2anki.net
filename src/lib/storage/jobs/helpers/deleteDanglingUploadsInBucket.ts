import { Knex } from 'knex';
import StorageHandler from '../../StorageHandler';
import {
  ErrorEventRepository,
  IErrorEventRepository,
} from '../../../../data_layer/ErrorEventRepository';
import {
  assessDeletionVolume,
  raiseDeletionVolumeAlarm,
} from './deletionVolumeAlert';
import { isDeletableBucketKey } from './isDeletableBucketKey';

const MAX_KEYS = 100_000;

/**
 * Removes bucket objects that no row references — genuine orphans left behind
 * by an interrupted write.
 *
 * The keep-set is every key in `uploads`, with no filter on the owner's
 * subscription state. Deciding whether an upload is still entitled to storage
 * belongs to deleteNonSubScriberUploadsInDatabase, which removes the row and
 * the object together and protects lifetime accounts, pass holders and shared
 * decks. This sweep only cleans up what nothing owns, so a file can never
 * outlive its row or disappear from under a user who still sees it listed.
 */
export const deleteDanglingUploadsInBucket = async (
  db: Knex,
  storage: StorageHandler,
  errorEvents: IErrorEventRepository = new ErrorEventRepository(db)
) => {
  const rows = await db('uploads').select('key');
  const referencedKeys = new Set<string>(
    (rows as { key?: string | null }[])
      .map((row) => row.key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0)
  );

  const storedFiles = (await storage.getContents(MAX_KEYS)) ?? [];
  const now = new Date();
  const orphans = storedFiles.filter((file) =>
    isDeletableBucketKey(file, referencedKeys, now)
  );

  const assessment = assessDeletionVolume(orphans.length, storedFiles.length);
  if (assessment.anomalous) {
    await raiseDeletionVolumeAlarm(
      'deleteDanglingUploadsInBucket',
      assessment,
      errorEvents
    );
    return;
  }

  for (const file of orphans) {
    if (file.Key) {
      console.info(`Deleting orphaned bucket object ${file.Key}`);
      await storage.delete(file.Key);
    }
  }
};
