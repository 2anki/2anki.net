#!/usr/bin/env bash
# Runs classify.sh against a stub gh that returns a fixed file list.
# Usage: bash .github/actions/changes/classify.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
stub=$(mktemp -d)
fail=0

expect() {
  local want=$1 ref=$2; shift 2
  printf '%s\n' "$@" > "$stub/files"
  cat > "$stub/gh" <<'STUB'
#!/usr/bin/env bash
cat "$(dirname "$0")/files"
STUB
  chmod +x "$stub/gh"
  local out
  out=$(cd "$here" && PATH="$stub:$PATH" GITHUB_REF="$ref" GITHUB_SHA=abc GITHUB_REPOSITORY=x/y GITHUB_OUTPUT=/dev/null bash ./classify.sh)
  if [ "$out" = "changes: code=$want ($# changed files vs main)" ]; then
    echo "ok   $want <- $*"
  else
    echo "FAIL want code=$want for [$*], got: $out"; fail=1
  fi
}

expect false refs/heads/feature .claude/commands/ship.md CLAUDE.md Documentation/specs/x.md
expect false refs/heads/feature VOICE.md
expect true  refs/heads/feature web/src/pages/DocsPage/content/cards/mind-maps.md
expect true  refs/heads/feature .github/workflows/server.yml
expect true  refs/heads/feature src/lib/parser/FEATURE.md src/lib/parser/DeckParser.ts
expect true  refs/heads/feature package.json
out=$(cd "$here" && PATH="$stub:$PATH" GITHUB_REF=refs/heads/main GITHUB_SHA=abc GITHUB_REPOSITORY=x/y GITHUB_OUTPUT=/dev/null bash ./classify.sh)
[ "$out" = "changes: code=true (0 changed files vs main)" ] && echo "ok   true <- (push to main, gh never consulted)" || { echo "FAIL main push: $out"; fail=1; }

# main, and an empty compare, always run the full suite
printf '' > "$stub/files"
out=$(cd "$here" && PATH="$stub:$PATH" GITHUB_REF=refs/heads/feature GITHUB_SHA=abc GITHUB_REPOSITORY=x/y GITHUB_OUTPUT=/dev/null bash ./classify.sh)
[ "$out" = "changes: code=true (0 changed files vs main)" ] && echo "ok   true <- (empty compare)" || { echo "FAIL empty compare: $out"; fail=1; }

rm -rf "$stub"
exit $fail
