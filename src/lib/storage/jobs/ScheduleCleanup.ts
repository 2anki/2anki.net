import { Knex } from 'knex';

import deleteOldUploads, { MS_21 } from './helpers/deleteOldUploads';
import { runFileSystemCleanup } from './helpers/runFileSystemCleanup';

export const MS_1_HOUR = 1000 * 60 * 60;
export const OLD_UPLOAD_CLEANUP_HOUR_UTC = 3;

/**
 * The old-upload sweep is anchored to the clock, not to process uptime. A
 * 24h interval from boot never fired on a week with more than one deploy a
 * day, then swept several days at once (1098 rows on 2026-09-24, tripping
 * the deletion-volume alarm). Ticking hourly and acting only inside one UTC
 * hour gives exactly one run per day however often the process restarts.
 */
export const ScheduleCleanup = (db: Knex): NodeJS.Timeout[] => {
  const fileSystemCleanup = setInterval(() => {
    runFileSystemCleanup(db).catch(console.error);
  }, MS_21);

  const oldUploadDeletion = setInterval(() => {
    if (new Date().getUTCHours() !== OLD_UPLOAD_CLEANUP_HOUR_UTC) return;
    deleteOldUploads(db)
      .then(() => console.info('deleted old uploads'))
      .catch(console.error);
  }, MS_1_HOUR);

  return [fileSystemCleanup, oldUploadDeletion];
};
