#!/usr/bin/env bash
#
# Restore the checkout to the last successfully deployed build after a failed
# blue-green cutover. The deploy workflow resets the shared checkout to
# origin/main and rebuilds BEFORE the health gate runs, so a failed gate leaves
# the live color serving old code from memory while the disk holds the broken
# build — any restart (max_memory_restart, a crash) then boots the poison and
# crashloops (the 2026-08-06 markdown-it 15 outage). This puts the disk back in
# sync with what is actually running.
#
# Never masks the deploy failure: exits 0 always; the caller preserves its own
# non-zero exit. See issue #4016.
set -uo pipefail

SERVER_DIR="${SERVER_DIR:-$HOME/src/github.com/2anki/2anki.net}"
LAST_GOOD_FILE="${DEPLOY_LAST_GOOD_FILE:-$HOME/.deploy_last_good}"

log() { echo "[restore-last-good] $*" >&2; }

if [ ! -s "$LAST_GOOD_FILE" ]; then
  log "no $LAST_GOOD_FILE recorded — cannot restore; disk may not match the live process"
  exit 0
fi

LAST_GOOD="$(tr -d '[:space:]' < "$LAST_GOOD_FILE")"
if ! [[ "$LAST_GOOD" =~ ^[0-9a-f]{7,40}$ ]]; then
  log "$LAST_GOOD_FILE holds '$LAST_GOOD', which is not a commit sha — cannot restore; disk may not match the live process"
  exit 0
fi
CURRENT="$(git -C "$SERVER_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"

if [ "$CURRENT" = "$LAST_GOOD" ]; then
  log "disk already at last-good $LAST_GOOD — nothing to restore"
  exit 0
fi

log "restoring disk from $CURRENT to last-good $LAST_GOOD"

if ADDED_MIGRATIONS="$(git -C "$SERVER_DIR" diff --no-color --no-renames --name-only --diff-filter=A "$LAST_GOOD" HEAD -- migrations/)"; then
  if [ -n "$ADDED_MIGRATIONS" ]; then
    log "migrations added since last-good (left applied if the failed build ran them): $(echo "$ADDED_MIGRATIONS" | sed 's#^migrations/##' | tr '\n' ' ')— boot tolerates them only if all sort after last-good's newest migration; otherwise check knex_migrations before restarting"
  else
    log "no migrations added since last-good"
  fi
else
  log "could not list migrations added since last-good — check knex_migrations by hand before restarting the live color"
fi

if ! git -C "$SERVER_DIR" checkout --detach "$LAST_GOOD"; then
  log "FAILED to check out $LAST_GOOD — disk is still poisoned; do not restart the live color"
  exit 0
fi

if ! pnpm --dir "$SERVER_DIR" install --frozen-lockfile; then
  log "FAILED to reinstall dependencies at $LAST_GOOD — disk is still poisoned; do not restart the live color"
  exit 0
fi

if ! pnpm --dir "$SERVER_DIR" run build; then
  log "FAILED to rebuild at $LAST_GOOD — disk is still poisoned; do not restart the live color"
  exit 0
fi

log "disk restored to last-good $LAST_GOOD — a live-color restart now boots the running code"
exit 0
