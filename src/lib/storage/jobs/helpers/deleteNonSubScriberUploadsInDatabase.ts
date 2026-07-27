import { Knex } from 'knex';
import StorageHandler from '../../StorageHandler';
import Uploads from '../../../../data_layer/public/Uploads';
import {
  ErrorEventRepository,
  IErrorEventRepository,
} from '../../../../data_layer/ErrorEventRepository';
import {
  assessDeletionVolume,
  raiseDeletionVolumeAlarm,
} from './deletionVolumeAlert';

export const deleteNonSubScriberUploadsInDatabase = async (
  db: Knex,
  storage: StorageHandler,
  errorEvents: IErrorEventRepository = new ErrorEventRepository(db)
) => {
  // Scoped to the user, not to a joined row: subscriptions has separate unique
  // indexes on email and linked_email, so one person legitimately holds both a
  // stale cancelled row and their current live one. A join-row predicate matches
  // the cancelled row and sweeps a paying subscriber's decks. Lowercasing both
  // sides matches AuthenticationService.getIsSubscriber, which is what the rest
  // of the product uses to decide the same question.
  const query = await db.raw(`
    SELECT up.key
    FROM users u
    JOIN uploads up ON u.id = up.owner
    WHERE u.patreon = false
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.active = true
          AND (
            lower(u.email) = lower(s.email)
            OR lower(u.email) = lower(s.linked_email)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_passes pass
        WHERE pass.user_id = u.id AND pass.expires_at > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM deck_shares ds
        WHERE ds.upload_key = up.key AND ds.revoked_at IS NULL
      );
  `);
  const nonSubScriberUploads: Uploads[] | undefined = query.rows;
  if (!nonSubScriberUploads) {
    return;
  }

  const candidates = nonSubScriberUploads.flat();

  const totalRow = await db('uploads').count('key as count').first();
  const tableTotal = Number(
    (totalRow as { count?: string | number } | undefined)?.count ?? 0
  );

  const assessment = assessDeletionVolume(candidates.length, tableTotal);
  if (assessment.anomalous) {
    await raiseDeletionVolumeAlarm(
      'deleteNonSubScriberUploadsInDatabase',
      assessment,
      errorEvents
    );
  }

  for (const upload of candidates) {
    console.info(`Deleting non-subscriber upload ${upload.key}`);
    await storage.delete(upload.key);
    await db('uploads').delete().where('key', upload.key);
  }
};
