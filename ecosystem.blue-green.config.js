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
//   node_args  — pm2 stores it (`pm2 describe` prints the interpreter arg) but
//                did not put it on the spawned command line. On 2026-07-29 the
//                live process ran as a bare `node src/server.js` while pm2
//                reported --max-old-space-size=16384, so the real limit was
//                node's ~4144MB default. The main thread OOM-crashed at 4189MB
//                (FATAL ERROR: NewSpace::EnsureCurrentCapacity) and pm2 restarted
//                it. Prior OOMs on 2026-07-18 have the same signature.
//   NODE_OPTIONS in env — pm2 puts this in the child's environment before exec,
//                which is early enough for V8. This is the one that takes effect.
//
// Do NOT move this into the box's .env: that file is read by dotenv at runtime,
// after the heap is already sized, so a NODE_OPTIONS there is inert. Prod had
// exactly that (8192) and it never applied.
//
// Verify after deploy — config is not proof, the command line is:
//   tr '\0' ' ' < /proc/$(pgrep -f src/server.js | head -1)/cmdline
const MAX_OLD_SPACE_MB = 8192;

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
  // 9G sits deliberately between two numbers. Above it: the ~11-12GB RSS where
  // an 8192MB main heap plus four 1024MB Piscina worker heaps actually dies, so
  // this fires first. Below it: the 24.7GB the box has free alongside Postgres,
  // so the kernel OOM-killer — which would pick its own victim, possibly
  // Postgres — never enters the picture. Normal operation sits near 450MB, and
  // the pre-crash climb on 2026-07-29 peaked at 6.0GB, so this should only ever
  // fire during a leak episode, not during ordinary heavy conversion load.
  //
  // If it turns out to fire routinely, the leak got worse — fix #3926 rather
  // than raising this.
  max_memory_restart: '9G',
};

const nodeOptions = `--max-old-space-size=${MAX_OLD_SPACE_MB}`;

module.exports = {
  apps: [
    {
      ...base,
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
