#!/usr/bin/env bash
# Stall-signal read for /deploy-status. Runs on the prod box, fed over stdin:
#   git show origin/main:scripts/stall-read.sh | ssh alemayhu@2anki.net 'bash -s -- 24'
# Kept out of the command file because the command loader rewrites positional
# dollar references and the remote shell expanded the rest inside double
# quotes, which broke every awk program in the old inline read.
set -u
export LC_ALL=C

HOURS="${1:-24}"
if ! [[ "$HOURS" =~ ^[0-9]+$ ]]; then
  echo "hours must be a whole number, got: $HOURS" >&2
  exit 2
fi
LOG_DIR="${STALL_LOG_DIR:-$HOME/.pm2/logs}"
SINCE=$(date -u -d "-${HOURS} hours" +%FT%H 2>/dev/null || date -u -v-"${HOURS}"H +%FT%H)

# The stall watch logs through console.warn, so its lines land in the error logs.
WINDOW=$(mktemp)
trap 'rm -f "$WINDOW"' EXIT
cat "$LOG_DIR"/server-*-out*.log "$LOG_DIR"/server-*-error*.log 2>/dev/null \
  | awk -v s="$SINCE" '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]/ && substr($0,1,13) >= s' \
  | sort > "$WINDOW"

LINES=$(wc -l < "$WINDOW" | tr -d ' ')
echo "== window: last ${HOURS}h (since ${SINCE}), ${LINES} lines"
if [ "$LINES" -eq 0 ]; then
  echo "no log lines in the window under $LOG_DIR, so there is nothing to read" >&2
  exit 3
fi

echo "== max pool_queue per hour (>=3)"
grep -a '\[memory\]' "$WINDOW" \
  | awk 'match($0, /pool_queue=[0-9]+/) { h = substr($0,1,13); v = substr($0,RSTART+11,RLENGTH-11) + 0; if (v > m[h]) m[h] = v }
         END { for (k in m) if (m[k] >= 3) print k, m[k] }' \
  | sort

echo "== pool_queue_interactive >= 1, samples per hour"
grep -aE 'pool_queue_interactive=[1-9]' "$WINDOW" | cut -c1-13 | uniq -c

echo "== no-response requests per hour (>=10)"
grep -aE 'HTTP/1.1" - - ' "$WINDOW" | cut -c1-13 | uniq -c | awk '$1 >= 10'

echo "== stall lines"
grep -ac '\[conversion-pool\] stall oldest_wait_s=' "$WINDOW" || true

echo "== max tempfile dwell (ms)"
grep -aoE 'dwellMs: [0-9]+' "$WINDOW" | awk '{ if ($2 > m) m = $2 } END { print m + 0 }'

echo "== PDF 500s (/api/apkg/pdf 5xx)"
grep -acE 'POST /api/apkg/pdf HTTP/1.1" 5' "$WINDOW" || true
