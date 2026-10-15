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

Then run the **stall-signal read** as a second SSH call. Run it every time: a stalled conversion queue produces no error line, so the error tail above is blind to it by construction. Between 2026-10-09 and 10-11, three stalls hung every upload for up to 88 minutes, and the only report was a customer email.

```bash
ssh -o ConnectTimeout=10 alemayhu@2anki.net 'S=$(date -u -d "-24 hours" +%FT%H); cd ~/.pm2/logs; cat server-*-out*.log | awk -v s="$S" "substr(\$0,1,13)>=s" | sort > /tmp/stall_ro.log; echo "== max pool_queue / pool_queue_interactive per hour (>=3)"; grep "\[memory\]" /tmp/stall_ro.log | sed -E "s/^(.{13}).*pool_queue=([0-9]+).*/\1 \2/" | awk "{if(\$2>m[\$1])m[\$1]=\$2} END{for(k in m) if(m[k]>=3) print k, m[k]}" | sort; grep -oE "^.{13}.*pool_queue_interactive=[1-9][0-9]*" /tmp/stall_ro.log | sed -E "s/^(.{13}).*=/\1 qi=/" | sort -u | tail -5; echo "== no-response requests per hour (>=10)"; grep -E "HTTP/1.1\" - - " /tmp/stall_ro.log | cut -c1-13 | uniq -c | awk "\$1>=10"; echo "== stall lines"; grep -c "\[conversion-pool\] stall" /tmp/stall_ro.log; echo "== max tempfile dwell (ms)"; grep -oE "dwellMs: [0-9]+" /tmp/stall_ro.log | awk "{if(\$2>m)m=\$2} END{print m+0}"; echo "== PDF 500s in 24h (/api/apkg/pdf 5xx)"; grep -cE "POST /api/apkg/pdf HTTP/1.1\" 5" /tmp/stall_ro.log; rm /tmp/stall_ro.log'
```

Thresholds. Any one of these makes the verdict **"watching: uploads queued"**, whatever the error count says:
- `pool_queue_interactive` is 1 or more for longer than a minute, or `pool_queue` is 10 or more in any hour;
- 10 or more requests with no status (`HTTP/1.1" - -`) in an hour, meaning requests the server never answered;
- any `[conversion-pool] stall` line (the watch emails ops once an upload waits 120s);
- a max `tempfile dwell` above 120000 ms.

Widen `-24 hours` to match the window you were asked about. "Errors in the last 7 days" means this read over 7 days too.

Then report concisely:

- **Process**: online / errored / restarted recently? Note recent uptime, not the lifetime ↺ counter.
- **Recent activity**: are real requests being served (200/304 in access logs)?
- **Stalls**: the stall-signal read above. Report the worst hour, or "none".
- **PDF 500s**: the `== PDF 500s in 24h` count from the stall read: 5xx answers on `/api/apkg/pdf`. An upper bound on the `unexpected` reason, since a 5xx thrown from route middleware or `ErrorHandler` counts too; the 400/413-class reasons (timeouts, crashes, card limit, too large, invalid apkg) are not in it, the ops → Conversions panel has the full breakdown. Report the number; non-zero is worth a look but is not itself a stall.
- **Errors**: distinguish user-facing thrown errors (e.g. `getNoPackageError`) from actual crashes (`uncaught exception`, native binding failures, EADDRINUSE).
- **Verdict**: one paragraph — "deploy healthy" / "watching X" / "broken" (the live process is down or crashlooping, or a failed deploy run with no confirmed last-good restore). A failed deploy run is "watching X" only when its log confirms the last-good restore ran and the live process is up; a failed run with no confirmed restore is broken, whatever the process table says (the 2026-08-06 shape). Inside `/ship`, broken → its step 8 revert; run on its own, report broken with the evidence and do not revert. Anything short of broken is "watching X" with the evidence.

Normal-on-deploy noise — do NOT flag these as faults: the ~25s graceful-shutdown timeout log and `failed to kill - retrying in 100ms` → `process killed` on the old slot (blue-green hands off, the retiring process drains then exits `code [0] via signal [SIGINT]` — that exit-0 SIGINT is a clean handoff, not a crash), and the pm2 `This PM2 is not UP TO DATE / Upgrade to version X` banner (cosmetic self-nag). Many rapid flips in the log just mean several deploys landed in a row.

Don't dump the full log. Surface specifics only when something is wrong.
