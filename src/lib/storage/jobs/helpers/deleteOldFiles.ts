import os from 'os';
import path from 'path';

import findRemoveSync from 'find-remove';
import { CLEANUP_AGE_SECONDS } from '../../../constants';

/**
 * Locally stored files are deleted after CLEANUP_AGE_SECONDS. This is to prevent the server from running out of space.
 * It will not affect files processed by the Notion integration which are stored in DigitalOcean space.
 * @param loc an absolute directory, or a name relative to os.tmpdir()
 */
function deleteFile(loc: string) {
  console.time(`finding & removing old ${loc} files`);
  // Prod configures WORKSPACE_BASE and UPLOAD_BASE as absolute paths; joining
  // those onto os.tmpdir() pointed the sweep at a directory that does not
  // exist, so it never removed anything (#4568).
  const root = path.isAbsolute(loc) ? loc : path.join(os.tmpdir(), loc);
  // `files: '*.*'` only matches extensioned files, so the extensionless UUID
  // workspace directories under /tmp/workspaces were never swept — 48 dirs /
  // 335MB accumulated in prod. `dir: '*'` matches every directory, and the
  // shared `age` filter still gates removal to entries older than
  // CLEANUP_AGE_SECONDS, so an in-flight conversion's fresh workspace survives.
  findRemoveSync(root, {
    files: '*.*',
    dir: '*',
    age: { seconds: CLEANUP_AGE_SECONDS },
  });
  console.timeEnd(`finding & removing old ${loc} files`);
}

/**
 * A convenience function to batch delete old files.
 * @param locations
 */
export default function deleteOldFiles(locations: string[]) {
  locations.forEach((loc) => {
    deleteFile(loc);
  });
}
