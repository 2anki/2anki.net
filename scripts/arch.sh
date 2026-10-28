#!/usr/bin/env bash
# Runs dependency-cruiser over src/ and fails when it checked nothing.
# Under an unsupported TypeScript it prints missing-tsc-transpiler, cruises
# 0 modules and still exits 0, which passed CI silently for two weeks (#5048).
set -uo pipefail

DEPCRUISE="${DEPCRUISE:-depcruise}"

# Paths are relative to the working directory, which pnpm sets to the repo root.
git clean -fX -q src || exit 1

output=$("$DEPCRUISE" src --config .dependency-cruiser.cjs 2>&1)
status=$?
printf '%s\n' "$output"

if grep -q 'missing-tsc-transpiler' <<<"$output"; then
  echo "arch: FAILED, dependency-cruiser found no TypeScript compiler it supports, so it skipped every .ts file. Run pnpm install, then check pnpm.packageExtensions in package.json (.claude/rules/dependencies.md)" >&2
  exit 1
fi
if grep -qE '(^|[^0-9])0 modules' <<<"$output"; then
  echo "arch: FAILED, dependency-cruiser cruised 0 modules. Check the exclude pattern in .dependency-cruiser.cjs" >&2
  exit 1
fi
if ! grep -qE '[0-9]+ modules' <<<"$output"; then
  echo "arch: FAILED, dependency-cruiser printed no module count. Its output above shows why it stopped" >&2
  exit 1
fi
exit "$status"
