#!/usr/bin/env bash
# Decide whether a push needs the full CI run. Branch protection requires
# every check, so a docs-only push cannot skip a job; it runs the job and
# lets it finish early instead. Anything unexpected counts as code.
set -u

code=true
count=0
if [ "${GITHUB_REF:-}" != "refs/heads/main" ] && [ -n "${GITHUB_SHA:-}" ]; then
  files=$(gh api "repos/${GITHUB_REPOSITORY}/compare/main...${GITHUB_SHA}" \
    --jq '.files[].filename' 2>/dev/null) || files=""
  count=$(printf '%s\n' "$files" | grep -c . || true)
  if [ "$count" -gt 0 ] && [ "$count" -lt 300 ]; then
    code=false
    while IFS= read -r file; do
      case "$file" in
        .claude/*|Documentation/*) ;;
        web/*) code=true; break ;;
        *.md) ;;
        *) code=true; break ;;
      esac
    done <<< "$files"
  fi
fi

echo "code=$code" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "changes: code=$code (${count} changed files vs main)"
