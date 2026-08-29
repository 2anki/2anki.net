const os = require('node:os');
const path = require('node:path');

// Blue-green variant. Two identical apps on two ports; the deploy script
// (scripts/deploy-blue-green.sh) starts exactly one at a time with
// `pm2 start ecosystem.blue-green.config.js --only server-<color>`.
//
// This IS the live deploy path — deploy.2anki.net.yml runs deploy-blue-green.sh,
// which reads this file. There is no ecosystem.config.js in the repo.
// See Documentation/deploy/blue-green.md for the Apache pairing.

// V8 sizes its heap from argv/NODE_OPTIONS at boot, so the ceiling has to reach
// the process before node starts. Two channels are declared because the obvious
// one silently does not work here:
//
//   node_args  — works sometimes, which is worse than never working. pm2 always
//                stores it (`pm2 describe` prints the interpreter arg), but only
//                sometimes puts it on the spawned command line. The GC logs show
//                both states: on 2026-07-18 the process died at 15673MB of a
//                16011MB heap, so 16384 was live; on 2026-07-29 it died at
//                4189MB of 4285MB — node's ~4144MB default — while pm2 still
//                reported the same interpreter arg. Nothing in this file changed
//                between those dates. Do not trust this channel alone.
//   NODE_OPTIONS in env — pm2 puts this in the child's environment before exec,
//                which is early enough for V8. Verified on prod 2026-07-29:
//                heap_size_limit went 4144MB -> 8240MB. This is the reliable one.
//
// Do NOT move this into the box's .env: that file is read by dotenv at runtime,
// after the heap is already sized, so a NODE_OPTIONS there is inert. Prod had
// exactly that (8192) and it never applied.
//
// Verify after deploy — config is not proof, the process is:
//   tr '\0' '\n' < /proc/$(pgrep -f src/server.js | head -1)/environ | grep NODE_OPTIONS

// 16384 is not arbitrary and should not be trimmed without evidence: the
// 2026-07-18 crash shows this process genuinely growing past 15.6GB, so a
// smaller ceiling converts conversions that used to complete into failures.
// Lowering it to 8192 on 2026-07-29 was a mistake made while believing the
// 16384 had never been active — the GC logs above disprove that.
const MAX_OLD_SPACE_MB = 16384;

// pm2's default log name carries the pm_id (server-blue-out-<id>.log), and pm2
// appends to whatever already sits at that name. `pm2 delete` on every cutover
// orphans the file and a daemon restart resets the id counter, so after the
// 2026-08-22 reboot each deploy landed on an id last used in June/July and wrote
// today's output onto a file whose head was two months old. Read by mtime, those
// files served July's NoActiveAnkifyClientError traces as live — #4203 and
// #4236 were both that, and their fixes (#4223, #4251) changed nothing real.
// A fixed per-color path leaves nothing stale to append to, and the timestamp
// on every line is what lets a reader scope a window by content, not by mtime.
const PM2_LOG_DIR = path.join(os.homedir(), '.pm2', 'logs');
const LOG_DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSSZ';

// merge_logs is not optional here: without it pm2 rewrites every log path,
// custom or default, to `…-<pm_id>.log` (lib/God.js "If merge option, dont
// separate the logs"), which is exactly how the first deploy of the fixed
// paths still produced server-green-out-46.log.
const logFiles = (name) => ({
  out_file: path.join(PM2_LOG_DIR, `${name}-out.log`),
  error_file: path.join(PM2_LOG_DIR, `${name}-error.log`),
  merge_logs: true,
  log_date_format: LOG_DATE_FORMAT,
});

const base = {
  script: 'src/server.js',
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  max_restarts: 10,
  min_uptime: '60s',
  // Window for src/server.ts graceful shutdown to drain HTTP, Piscina,
  // and Knex before pm2 escalates to SIGKILL. Must stay above
  // SHUTDOWN_TIMEOUT_MS in src/lib/gracefulShutdown.ts (currently 85s) so a slow
  // large-deck conversion finishes instead of being force-killed at the swap.
  // Safe to be generous: blue-green serves users on the new color while the old
  // color drains, so this only delays reaping the retired process.
  kill_timeout: 90000,
  node_args: `--max-old-space-size=${MAX_OLD_SPACE_MB}`,
  // Main-thread memory grows unbounded under load and eventually reaches
  // whatever ceiling is set (issue #3926 — 3 OOM crashes, 2026-07-18 and
  // 2026-07-29). Raising the ceiling only lengthens the fuse, so pm2 recycles
  // the process before V8 hits the wall: SIGINT first, which src/server.ts
  // drains through gracefulShutdown within kill_timeout, instead of a hard
  // FATAL ERROR that drops in-flight conversions with no drain.
  //
  // 12G sits deliberately between three numbers. Above the 6.0GB peak of the
  // 2026-07-29 pre-crash climb, so ordinary heavy conversion load does not trip
  // it. Below the ~16GB heap wall the 2026-07-18 crash actually hit, so the
  // recycle wins that race. Below the 24.7GB the box has free alongside
  // Postgres, so the kernel OOM-killer — which picks its own victim, possibly
  // Postgres — never enters the picture. Normal operation sits near 450MB.
  //
  // If it fires routinely, the leak got worse — fix #3926 rather than raising
  // this. Raising it past the heap ceiling would disable it silently.
  max_memory_restart: '12G',
};

const nodeOptions = `--max-old-space-size=${MAX_OLD_SPACE_MB}`;

module.exports = {
  apps: [
    {
      ...base,
      ...logFiles('server-blue'),
      name: 'server-blue',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        GIT_SHA: process.env.GIT_SHA,
        NODE_OPTIONS: nodeOptions,
      },
    },
    {
      ...base,
      ...logFiles('server-green'),
      name: 'server-green',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        GIT_SHA: process.env.GIT_SHA,
        NODE_OPTIONS: nodeOptions,
      },
    },
  ],
};
