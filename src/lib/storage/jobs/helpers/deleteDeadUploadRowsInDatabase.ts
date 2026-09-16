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
import { isReservedKey } from './isDeletableBucketKey';

const MAX_KEYS = 100_000;

interface UploadRow {
  id: number;
  key: string;
  owner: number;
}

/**
 * Removes uploads rows whose bucket object no longer exists — the mirror image
 * of deleteDanglingUploadsInBucket, which removes objects that no row
 * references. The pre-#3881 orphan sweep deleted objects without their rows, so
 * owners still see those decks listed in /api/upload/mine even though the
 * download 404s. This backstop makes that class of bug self-heal on the daily
 * cleanup instead of lingering until a human runs the prune-dead-uploads ops
 * command.
 *
 * A bucket listing that came back empty, or that hit the paging cap, cannot
 * tell a dead row from a live one — every row past the cap would look dead. In
 * either case the run refuses to delete anything rather than guess.
 */
export const deleteDeadUploadRowsInDatabase = async (
  db: Knex,
  storage: StorageHandler,
  errorEvents: IErrorEventRepository = new ErrorEventRepository(db)
) => {
  const storedFiles = (await storage.getContents(MAX_KEYS)) ?? [];
  const existingKeys = new Set<string>(
    storedFiles
      .map((file) => file.Key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0)
  );

  if (existingKeys.size === 0) {
    console.error(
      '[deleteDeadUploadRowsInDatabase] bucket listing came back empty; refusing to judge any row dead'
    );
    return;
  }
  if (storedFiles.length >= MAX_KEYS) {
    console.error(
      '[deleteDeadUploadRowsInDatabase] bucket listing hit the paging cap; refusing to judge rows past it'
    );
    return;
  }

  const rows = (await db('uploads')
    .select('id', 'key', 'owner')
    .whereNotNull('key')) as UploadRow[];
  const deadRows = rows.filter(
    (row) =>
      typeof row.key === 'string' &&
      row.key.length > 0 &&
      !isReservedKey(row.key) &&
      !existingKeys.has(row.key)
  );

  const assessment = assessDeletionVolume(deadRows.length, rows.length);
  if (assessment.anomalous) {
    await raiseDeletionVolumeAlarm(
      'deleteDeadUploadRowsInDatabase',
      assessment,
      errorEvents
    );
    return;
  }

  for (const row of deadRows) {
    console.info(
      `Deleting dead upload row ${row.id} (owner ${row.owner}) — bucket object ${row.key} is gone`
    );
    await db('uploads').where({ id: row.id }).del();
  }
};
