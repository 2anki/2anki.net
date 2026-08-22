import { Knex } from 'knex';

import deleteOldUploads, {
  MS_21,
  MS_24_HOURS,
} from './helpers/deleteOldUploads';
import { runFileSystemCleanup } from './helpers/runFileSystemCleanup';

export const ScheduleCleanup = (db: Knex): NodeJS.Timeout[] => {
  const fileSystemCleanup = setInterval(() => {
    runFileSystemCleanup(db).catch(console.error);
  }, MS_21);

  const oldUploadDeletion = setInterval(
    () =>
      deleteOldUploads(db)
        .then(() => console.info('deleted old uploads'))
        .catch(console.error),
    MS_24_HOURS
  );

  return [fileSystemCleanup, oldUploadDeletion];
};
