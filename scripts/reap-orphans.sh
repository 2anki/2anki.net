#!/usr/bin/env bash
# Reap orphaned dev/build node processes left behind by parallel agents and
# long-lived dev servers. See .claude/docs/local-dev.md ("Orphaned process
# hygiene") for the incident this exists to prevent.
#
# What it targets — ONLY node processes reparented to init (PPID 1), i.e. ones
# whose spawning agent/shell/session already exited, matching a dev-server or
# build-tool signature:
#   - vite preview / vite dev / pnpm dev  (leftover dev servers)
#   - server.mjs                          (leftover app server)
#   - tsc / jest / vitest / esbuild       (stuck /check runs)
# A process with a LIVE parent (PPID != 1) is never touched — that is an
# actively-running agent's work, not an orphan.
#
# Usage:
#   scripts/reap-orphans.sh          # dry run — list what WOULD be killed
#   scripts/reap-orphans.sh --force  # actually kill (TERM, then KILL after 3s)
#
# Safe to run anytime; the dry run has no side effects.

set -u

FORCE=0
[ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ] && FORCE=1

# PPID==1 (orphaned) + node + a dev-server/build-tool signature.
# Print "pid<TAB>etime<TAB>command" for matches.
matches() {
  ps -Ao pid=,ppid=,etime=,command= 2>/dev/null | awk '
    $2 == 1 && /node/ &&
    /(vite[^A-Za-z]|server\.mjs|pnpm[[:space:]]+dev|[[:space:]]tsc([[:space:]]|$)|jest|vitest|esbuild)/ {
      pid = $1; et = $3;
      cmd = $0; sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+[^[:space:]]+[[:space:]]+/, "", cmd);
      printf "%s\t%s\t%s\n", pid, et, substr(cmd, 1, 90);
    }'
}

MATCHES=$(matches)

if [ -z "$MATCHES" ]; then
  echo "No orphaned dev/build node processes (PPID 1). Nothing to reap."
  exit 0
fi

COUNT=$(printf '%s\n' "$MATCHES" | grep -c .)
echo "Orphaned dev/build node processes (PPID 1) — $COUNT found:"
echo
printf '  %-8s %-14s %s\n' "PID" "ELAPSED" "COMMAND"
printf '%s\n' "$MATCHES" | while IFS=$'\t' read -r pid et cmd; do
  printf '  %-8s %-14s %s\n' "$pid" "$et" "$cmd"
done
echo

PIDS=$(printf '%s\n' "$MATCHES" | cut -f1)

if [ "$FORCE" -ne 1 ]; then
  echo "Dry run. Re-run with --force to kill these."
  exit 0
fi

echo "Sending TERM..."
# shellcheck disable=SC2086
kill -TERM $PIDS 2>/dev/null
sleep 3
STILL=$(printf '%s\n' "$PIDS" | while read -r p; do kill -0 "$p" 2>/dev/null && echo "$p"; done)
if [ -n "$STILL" ]; then
  echo "Sending KILL to survivors: $(printf '%s ' $STILL)"
  # shellcheck disable=SC2086
  kill -KILL $STILL 2>/dev/null
fi
echo "Reaped $COUNT process(es)."
exit 0
