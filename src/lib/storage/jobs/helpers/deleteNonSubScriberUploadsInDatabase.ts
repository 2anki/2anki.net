import { Knex } from 'knex';
import StorageHandler from '../../StorageHandler';
import Uploads from '../../../../data_layer/public/Uploads';
import { SHARE_INACTIVITY_TTL_DAYS } from '../../../constants';
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
  // Developer tiers live in subscriptions_developer (#3902), not subscriptions.
  // Without the second clause a customer whose only paid subscription is a
  // developer tier reads as a free user here and has their uploads deleted from
  // the bucket irreversibly. Matching on email as well as user_id only ever
  // spares a row, so a loose match is the safe direction.
  // A share only pins its upload while it has been viewed (or created, if
  // never viewed) within the TTL. Without the recency bound any free user
  // could pin storage forever by creating a share and never revoking it
  // (#3831). last_viewed_at is null for shares that predate the column's
  // backfill window, so created_at is the fallback. The cutoff is computed
  // here and bound as a parameter because sqlite (the e2e test dialect) has
  // no interval arithmetic.
  const sharePinCutoff = new Date(
    Date.now() - SHARE_INACTIVITY_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const query = await db.raw(
    `
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
        SELECT 1 FROM subscriptions_developer sd
        WHERE sd.active = true
          AND (sd.user_id = u.id OR lower(u.email) = lower(sd.email))
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_passes pass
        WHERE pass.user_id = u.id AND pass.expires_at > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM deck_shares ds
        WHERE ds.upload_key = up.key
          AND ds.revoked_at IS NULL
          AND COALESCE(ds.last_viewed_at, ds.created_at) > ?
      );
  `,
    [sharePinCutoff]
  );
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
    // deck_shares.upload_key has no FK to uploads, so nothing cascades: revoke
    // the dead pins here or /shared-decks keeps listing decks that 404.
    // Per-upload rather than batched after the loop so a mid-loop failure
    // can't leave already-deleted uploads with live share rows.
    await db('deck_shares')
      .where('upload_key', upload.key)
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() });
  }
};
