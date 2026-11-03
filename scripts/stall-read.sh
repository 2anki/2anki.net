#!/usr/bin/env bash
# Stall-signal read for /deploy-status. Runs on the prod box, fed over stdin:
#   ssh alemayhu@2anki.net 'bash -s -- 24' < scripts/stall-read.sh
# Kept out of the command file because the command loader rewrites $1/$2 and
# the remote shell expands $0 inside double quotes, which broke every awk here.
set -u

HOURS="${1:-24}"
LOG_DIR="${STALL_LOG_DIR:-$HOME/.pm2/logs}"
SINCE=$(date -u -d "-${HOURS} hours" +%FT%H 2>/dev/null || date -u -v-"${HOURS}"H +%FT%H)

WINDOW=$(mktemp)
trap 'rm -f "$WINDOW"' EXIT
cat "$LOG_DIR"/server-*-out*.log 2>/dev/null | awk -v s="$SINCE" 'substr($0,1,13)>=s' | sort > "$WINDOW"

echo "== window: last ${HOURS}h (since ${SINCE}), $(wc -l < "$WINDOW" | tr -d ' ') lines"

echo "== max pool_queue per hour (>=3)"
grep '\[memory\]' "$WINDOW" \
  | awk 'match($0, /pool_queue=[0-9]+/) { h = substr($0,1,13); v = substr($0,RSTART+11,RLENGTH-11) + 0; if (v > m[h]) m[h] = v }
         END { for (k in m) if (m[k] >= 3) print k, m[k] }' \
  | sort

echo "== pool_queue_interactive >= 1, samples per hour"
grep -E 'pool_queue_interactive=[1-9]' "$WINDOW" | cut -c1-13 | uniq -c

echo "== no-response requests per hour (>=10)"
grep -E 'HTTP/1.1" - - ' "$WINDOW" | cut -c1-13 | uniq -c | awk '$1 >= 10'

echo "== stall lines"
grep -c '\[conversion-pool\] stall' "$WINDOW" || true

echo "== max tempfile dwell (ms)"
grep -oE 'dwellMs: [0-9]+' "$WINDOW" | awk '{ if ($2 > m) m = $2 } END { print m + 0 }'

echo "== PDF 500s (/api/apkg/pdf 5xx)"
grep -cE 'POST /api/apkg/pdf HTTP/1.1" 5' "$WINDOW" || true
