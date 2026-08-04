#!/usr/bin/env bash
#
# worktree-setup.sh — make a fresh git worktree usable.
#
# A `git worktree add` / EnterWorktree checkout has source only: no
# node_modules in either workspace, and the Oxc native binaries
# (@oxlint/binding-*, @oxfmt/binding-*) are frequently missing even after a
# plain `pnpm install` because pnpm skips the optional platform dep. Until
# this runs, `pnpm test` reports `jest: command not found` and oxfmt/oxlint
# die with `Cannot find native binding`.
#
# Run this as the FIRST action in any new worktree. Idempotent — safe to
# re-run. See CLAUDE.md "Run it" and .claude/docs/parallel-pr-coordination.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[worktree-setup] installing root + web workspaces in $ROOT"
pnpm install
pnpm --filter 2anki-web install

# Verify the Oxc native bindings actually load; if not, force a reinstall
# rather than hand-copying .node files (which pollutes node_modules) or
# `pnpm add`-ing a binding (which dirties package.json/lockfile).
if ! pnpm exec oxfmt --help >/dev/null 2>&1 || ! pnpm exec oxlint --help >/dev/null 2>&1; then
  echo "[worktree-setup] Oxc native binding missing — forcing reinstall"
  pnpm install --force
fi

echo "[worktree-setup] verifying toolchain"
pnpm exec jest --version >/dev/null && echo "  jest    ok"
pnpm exec oxfmt --help >/dev/null 2>&1 && echo "  oxfmt   ok"
pnpm exec oxlint --help >/dev/null 2>&1 && echo "  oxlint  ok"

echo "[worktree-setup] done — pnpm test / oxfmt / oxlint are ready"
