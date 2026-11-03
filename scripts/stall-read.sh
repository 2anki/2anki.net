#!/usr/bin/env bash
# Stall-signal read for /deploy-status. Runs on the prod box, fed over stdin:
#   git show origin/main:scripts/stall-read.sh | ssh alemayhu@2anki.net 'bash -s -- 24'
#   git show origin/main:scripts/stall-read.sh | ssh alemayhu@2anki.net 'bash -s -- 2026-11-03T09:30'
# The argument is a window in hours, or a UTC start (to the hour or minute) such
# as a deploy time. Kept out of the command file because the command loader
# rewrites positional dollar references and the remote shell expanded the rest
# inside double quotes, which broke every awk program in the old inline read.
set -u
export LC_ALL=C

ARG="${1:-24}"
if [[ "$ARG" =~ ^[0-9]+$ ]]; then
  SINCE=$(date -u -d "-${ARG} hours" +%FT%H 2>/dev/null || date -u -v-"${ARG}"H +%FT%H)
  LABEL="last ${ARG}h"
elif [[ "$ARG" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}(:[0-9]{2}(:[0-9]{2})?)?Z?$ ]]; then
  SINCE="${ARG%Z}"
  SINCE="${SINCE:0:16}"
  LABEL="from ${SINCE} UTC"
else
  echo "window must be whole hours or a UTC start like 2026-11-03T09:30, got: $ARG" >&2
  exit 2
fi
if [ -z "$SINCE" ]; then
  echo "could not work out a window start from: $ARG" >&2
  exit 2
fi
LOG_DIR="${STALL_LOG_DIR:-$HOME/.pm2/logs}"

in_window() {
  awk -v s="$SINCE" '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]/ && substr($0,1,length(s)) >= s'
}

# The stall watch logs through console.warn, so its lines land in the error logs.
WINDOW=$(mktemp)
trap 'rm -f "$WINDOW"' EXIT
cat "$LOG_DIR"/server-*-out*.log "$LOG_DIR"/server-*-error*.log 2>/dev/null | in_window | sort > "$WINDOW"

LINES=$(wc -l < "$WINDOW" | tr -d ' ')
SAMPLES=$(grep -ac '\[memory\]' "$WINDOW")
echo "== window: ${LABEL} (since ${SINCE}), ${LINES} lines, ${SAMPLES} memory samples"
if [ "$LINES" -eq 0 ]; then
  echo "no log lines in the window under $LOG_DIR, so there is nothing to read" >&2
  exit 3
fi
if [ "$SAMPLES" -eq 0 ]; then
  echo "no [memory] samples in the window, so the out logs were not read" >&2
  exit 4
fi

echo "== max pool_queue per hour (>=3)"
grep -a '\[memory\]' "$WINDOW" \
  | awk 'match($0, /pool_queue=[0-9]+/) { h = substr($0,1,13); v = substr($0,RSTART+11,RLENGTH-11) + 0; if (v > m[h]) m[h] = v }
         END { for (k in m) if (m[k] >= 3) print k, m[k] }' \
  | sort

# Each process samples once a minute, so a streak walks one color's samples in
# order: a zero sample or a gap of more than two minutes ends it, and during a
# blue-green cutover the two colors' samples never join up.
echo "== longest pool_queue_interactive >= 1 streak per color (samples, one a minute)"
for color in blue green; do
  cat "$LOG_DIR"/server-"$color"-out*.log 2>/dev/null | in_window | grep -a '\[memory\]' | sort \
    | awk -v c="$color" '
        function days(y, mo, d) { if (mo < 3) { y--; mo += 12 }; return 365 * y + int(y / 4) - int(y / 100) + int(y / 400) + int((153 * (mo - 3) + 2) / 5) + d }
        match($0, /pool_queue_interactive=[0-9]+/) {
          t = days(substr($0,1,4) + 0, substr($0,6,2) + 0, substr($0,9,2) + 0) * 1440 + substr($0,12,2) * 60 + substr($0,15,2)
          if (seen && t == pt) next
          q = substr($0, RSTART + 23, RLENGTH - 23) + 0
          if (q < 1) n = 0
          else if (n > 0 && t - pt <= 2) n++
          else { n = 1; start = substr($0,1,16) }
          if (n > best) { best = n; bstart = start }
          pt = t; seen = 1 }
        END { if (best > 0) print c, bstart, best }'
done

echo "== no-response requests per hour (>=10)"
grep -aE 'HTTP/1.1" - - ' "$WINDOW" | cut -c1-13 | uniq -c | awk '$1 >= 10'

echo "== stall lines"
grep -ac '\[conversion-pool\] stall oldest_wait_s=' "$WINDOW" || true

echo "== max tempfile dwell (ms)"
grep -aoE 'dwellMs: [0-9]+' "$WINDOW" | awk '{ if ($2 > m) m = $2 } END { print m + 0 }'

echo "== PDF 500s (/api/apkg/pdf 5xx)"
grep -acE 'POST /api/apkg/pdf HTTP/1.1" 5' "$WINDOW" || true
