import os from 'node:os';
import path from 'node:path';

// pm2 names a process's log files after its pm_id by default
// (server-blue-out-<id>.log) and appends to whatever file already sits at that
// name. `pm2 delete` on every blue-green cutover orphans the file, a pm2 daemon
// restart resets the id counter, and the next deploy that lands on a reused id
// appends today's output onto July's. That is how the closed NoActiveAnkifyClient
// polling errors resurfaced in the 2026-08-23..28 logs (#4203, #4236 — both
// chased July ghosts). A fixed per-color path removes the id from the name so
// there is nothing stale to append to, and a timestamp on every line lets a
// reader scope a window by content rather than by file mtime.
const config = require(
  path.resolve(__dirname, '../../ecosystem.blue-green.config.js')
) as {
  apps: Array<{
    name: string;
    out_file?: string;
    error_file?: string;
    log_date_format?: string;
    merge_logs?: boolean;
  }>;
};

const PM2_LOG_DIR = path.join(os.homedir(), '.pm2', 'logs');

describe('blue-green ecosystem config — log files', () => {
  it.each(['server-blue', 'server-green'])(
    'pins %s to fixed log paths under ~/.pm2/logs with no pm_id in the name',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;

      expect(app.out_file).toBe(path.join(PM2_LOG_DIR, `${name}-out.log`));
      expect(app.error_file).toBe(path.join(PM2_LOG_DIR, `${name}-error.log`));
    }
  );

  // pm2 rewrites every log path to `…-<pm_id>.log` unless merge_logs is set
  // (lib/God.js), so out_file alone still produced server-green-out-46.log on
  // prod after #4279 deployed. This flag is what makes the fixed path stick.
  it.each(['server-blue', 'server-green'])(
    'sets merge_logs on %s so pm2 does not append the pm_id to the fixed paths',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;

      expect(app.merge_logs).toBe(true);
    }
  );

  it('gives each color its own files so the two slots never interleave', () => {
    const paths = config.apps.flatMap((app) => [app.out_file, app.error_file]);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it.each(['server-blue', 'server-green'])(
    'stamps every %s log line with an ISO date so a window can be scoped by content',
    (name) => {
      const app = config.apps.find((candidate) => candidate.name === name)!;

      expect(app.log_date_format).toBe('YYYY-MM-DDTHH:mm:ss.SSSZ');
    }
  );
});
