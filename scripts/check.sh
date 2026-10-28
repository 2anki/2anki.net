#!/usr/bin/env bash
# Runs /check's legs in parallel and exits non-zero when any of them fails.
# A bare `wait` returns 0 whatever the children exit with, so /check used to
# report success with a failing leg (#5070).
set -u

PNPM="${PNPM:-pnpm}"
legs=(
  "typecheck"
  "arch"
  "--filter 2anki-web typecheck"
  "--filter 2anki-web test:run"
  "--filter 2anki-web lint"
)

pids=()
for leg in "${legs[@]}"; do
  # shellcheck disable=SC2086 # each leg is pnpm arguments, split on purpose
  "$PNPM" $leg &
  pids+=("$!")
done

failed=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    echo "check: FAILED, pnpm ${legs[$i]}" >&2
    failed=1
  fi
done
exit "$failed"
