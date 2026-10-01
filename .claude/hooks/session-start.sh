#!/usr/bin/env bash
# SessionStart: print branch, last week's commits, open TODOs in tracked source.
# Output goes to additionalContext (stdout). Always exits 0.
set -u

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "<not a git repo>")
LAST_COMMITS=$(git log --pretty=format:'  %h %s (%cr)' --since='1 week ago' 2>/dev/null)
[ -z "$LAST_COMMITS" ] && LAST_COMMITS="  <no commits in the last week>"

# Cap TODO scan to tracked TS/TSX in src/, excluding test files.
# Test fixtures often contain the literal string "TODO" inside markdown samples,
# which the unfiltered grep surfaces as a fake TODO every session.
TODOS=$(git ls-files 'src/*.ts' 'src/*.tsx' 2>/dev/null \
  | grep -v -E '\.test\.tsx?$' \
  | xargs grep -nE '\b(TODO|FIXME|XXX|HACK)\b' 2>/dev/null \
  | head -n 15)
TODO_COUNT=$(printf '%s' "$TODOS" | grep -c .)

cat <<EOF
## Session start

- Branch: $BRANCH
- Commits in the last week:
$LAST_COMMITS
- Open TODOs (first 15, tracked .ts/.tsx in src/): $TODO_COUNT match(es)
EOF

if [ "$TODO_COUNT" -gt 0 ]; then
  echo
  echo '```'
  printf '%s\n' "$TODOS"
  echo '```'
fi

# Orphaned dev/build process guard. Parallel agents each running /check stack
# node procs that outlive the agent, and dev servers (vite preview, tsx watch,
# pnpm dev) reparent to init when their session exits — a 2026-07-18 session let
# 23 such procs accumulate (load average hit 40) plus a 3-day vite preview and an
# 11-day dev server. This warns (never kills); run scripts/reap-orphans.sh to clean.
# `tsx` is matched as a command word only, never as a .tsx filename (hence the
# leading [^A-Za-z.], which also avoids a `/` - awk's regex literal in
# scripts/reap-orphans.sh cannot contain one): `pnpm dev:server`
# is `tsx watch src/server.ts`, and once its pnpm wrapper dies the tsx process
# reparents to init - which the old `server.mjs` pattern could not see at all,
# since no such file has ever existed in this repo.
ORPHANS=$(ps -Ao pid=,ppid=,command= 2>/dev/null | awk '
  $2 == 1 && /node/ &&
  /(vite[^A-Za-z]|(^|[^A-Za-z.])tsx[[:space:]]|pnpm[[:space:]]+dev|[[:space:]]tsc([[:space:]]|$)|jest|vitest|esbuild)/')
ORPHAN_COUNT=$(printf '%s' "$ORPHANS" | grep -c .)

if [ "$ORPHAN_COUNT" -gt 0 ]; then
  echo
  echo "- ⚠️  Orphaned dev/build node processes (PPID 1): $ORPHAN_COUNT — likely leftover"
  echo "  dev servers or stuck /check runs eating CPU. Inspect + clean:"
  echo '  `scripts/reap-orphans.sh` (dry run) then `scripts/reap-orphans.sh --force`.'
fi

exit 0
