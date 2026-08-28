---
description: SSH to 2anki.net, show pm2 status and recent server log tail
allowed-tools: Bash
---

Run a single SSH call:

```bash
ssh -o ConnectTimeout=10 alemayhu@2anki.net "pm2 list && echo '---LOGS---' && pm2 logs --lines 80 --nostream 2>&1 | tail -100"
```

The app runs **blue-green**, so the live process is `server-green` or `server-blue` — never plain `server`. Hardcoding `pm2 logs server` returns an empty tail (no process by that name). Omit the process name so `pm2 logs` tails whichever slot is live (the two pm2 modules, `pm2-logrotate` and `pm2-server-monit`, are low-volume and won't drown the app log). If you need to scope to one process, read the active name from the `pm2 list` table first.

Every app line carries an ISO timestamp prefix (`log_date_format` in `ecosystem.blue-green.config.js`; the files are `~/.pm2/logs/server-<color>-{out,error}.log` plus dated rotations). To read a window — "errors in the last 5 days" — filter on that prefix. Never scope by file mtime or `find -newermt`: pm2 appends to whatever already sits at a log path, and after the 2026-08-22 daemon restart reused pm_ids appended fresh output onto July files, so mtime-scoped reads reported July's `NoActiveAnkifyClientError` as live and spawned two phantom fixes (#4203 → #4223, #4236 → #4251).

Then report concisely:

- **Process**: online / errored / restarted recently? Note recent uptime, not the lifetime ↺ counter.
- **Recent activity**: are real requests being served (200/304 in access logs)?
- **Errors**: distinguish user-facing thrown errors (e.g. `getNoPackageError`) from actual crashes (`uncaught exception`, native binding failures, EADDRINUSE).
- **Verdict**: one paragraph — "deploy healthy" / "watching X" / "broken, escalate".

Normal-on-deploy noise — do NOT flag these as faults: the ~25s graceful-shutdown timeout log and `failed to kill - retrying in 100ms` → `process killed` on the old slot (blue-green hands off, the retiring process drains then exits `code [0] via signal [SIGINT]` — that exit-0 SIGINT is a clean handoff, not a crash), and the pm2 `This PM2 is not UP TO DATE / Upgrade to version X` banner (cosmetic self-nag). Many rapid flips in the log just mean several deploys landed in a row.

Don't dump the full log. Surface specifics only when something is wrong.
