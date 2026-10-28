#!/usr/bin/env bash
# Runs dependency-cruiser over src/ and fails when it checked nothing.
# Under an unsupported TypeScript it prints missing-tsc-transpiler, cruises
# 0 modules and still exits 0, which passed CI silently for two weeks (#5048).
set -uo pipefail

DEPCRUISE="${DEPCRUISE:-depcruise}"

git clean -fX -q src

output=$("$DEPCRUISE" src --config .dependency-cruiser.cjs 2>&1)
status=$?
printf '%s\n' "$output"

if grep -q 'missing-tsc-transpiler' <<<"$output"; then
  echo "arch: FAILED, dependency-cruiser found no TypeScript compiler it supports, so it skipped every .ts file" >&2
  exit 1
fi
if grep -qE '(^|[^0-9])0 modules' <<<"$output"; then
  echo "arch: FAILED, dependency-cruiser cruised 0 modules" >&2
  exit 1
fi
if ! grep -qE '[0-9]+ modules' <<<"$output"; then
  echo "arch: FAILED, dependency-cruiser printed no module count" >&2
  exit 1
fi
exit "$status"
