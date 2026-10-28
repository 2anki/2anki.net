import path from 'path';
import os from 'os';

import type { Knex } from 'knex';

import deleteOldFiles from './deleteOldFiles';
import { getDatabase } from '../../../../data_layer';

export const runFileSystemCleanup = async (database: Knex) => {
  console.time('running cleanup');
  const locations = [
    process.env.WORKSPACE_BASE ?? path.join(os.tmpdir(), 'workspaces'),
    process.env.UPLOAD_BASE ?? path.join(os.tmpdir(), 'uploads'),
  ];

  deleteOldFiles(locations);
  await database.raw(
    "DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '14 days' AND status = 'failed'"
  );
  console.timeEnd('running cleanup');
};

if (require.main === module) {
  runFileSystemCleanup(getDatabase())
    .then(() => console.log('Cleanup complete'))
    .catch(console.error);
}
