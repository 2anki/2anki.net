#!/usr/bin/env bash
# Runs dependency-cruiser over src/ and fails when it checked nothing.
# Under an unsupported TypeScript it prints missing-tsc-transpiler, cruises
# 0 modules and still exits 0, which passed CI silently for two weeks (#5048).
set -uo pipefail

DEPCRUISE="${DEPCRUISE:-depcruise}"
# A partly blind cruise (stale .js beside the .ts sources) keeps a module
# count but loses most of its edges, and every error rule passes (#5071).
# Measured 1282 modules and 4319 dependencies on 2026-10-28: lower these
# floors when src/ shrinks a lot.
MIN_MODULES=1000
MIN_DEPENDENCIES=3000

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
counts=$(grep -oE '[0-9]+ modules, [0-9]+ dependencies' <<<"$output" | tail -n 1)
modules=$(awk '{print $1}' <<<"$counts")
dependencies=$(awk '{print $3}' <<<"$counts")
if [ -z "$modules" ] || [ "$modules" -lt "$MIN_MODULES" ] || [ "${dependencies:-0}" -lt "$MIN_DEPENDENCIES" ]; then
  echo "arch: FAILED, dependency-cruiser cruised ${modules:-?} modules and ${dependencies:-?} dependencies, below the floor of $MIN_MODULES and $MIN_DEPENDENCIES. Stale .js beside the .ts sources blinds the cruise; check for a concurrent build" >&2
  exit 1
fi
exit "$status"
