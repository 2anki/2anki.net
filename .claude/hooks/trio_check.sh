#!/usr/bin/env bash
# Injects a trio-review reminder when a prompt touches user-facing product territory.
# Reads the UserPromptSubmit JSON from stdin; emits additionalContext if the heuristic fires.

set -euo pipefail

prompt=$(cat | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prompt',''))" 2>/dev/null || true)

# Exclusion: skip when the prompt is clearly about internal tooling, CI, deps, or .claude/ config.
# These false-positive on the keyword regex below (e.g. "user-facing copy" appears in design rules)
# and a wasted trio costs 3 forks (opus + opus + sonnet) per fire.
# Match both `.claude/` (path form) and bare `.claude` / `claude folder` (prose form).
if echo "$prompt" | grep -qiE \
  '(^|[^a-z])\.claude([/.]|\b)|\bclaude (folder|setup|config|housekeep)|/hooks/|/rules/|/agents/|/commands/|/skills/|\bCI\b|dependabot|dependenc(y|ies)|(internal|build|test) tooling|sub.?agent|prompt cache|model routing'; then
  exit 0
fi

# Heuristic: product-relevant keywords. Tune this list as false-positive/negative patterns emerge.
if echo "$prompt" | grep -qiE \
  'feature|user.facing|ux|ui\b|flow|onboard|sign.?up|pricing|limit|button|screen|page|copy|error message|landing|conversion|upload|deck|card|notion|export|first.run|retention|churn|analytics|instrumentation|usage event|funnel|metric|keep or remove|adoption review'; then
  python3 - <<'PYEOF'
import json, sys
result = {
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": (
      "<trio_required>User-facing change detected. "
      "Spawn pm + designer + engineer in one parallel Agent call before any code — "
      "each catches what a solo author misses. "
      "Synthesize agreements, conflicts, plan; then proceed. "
      "/trio forces it; the synthesis keeps every change traceable to "
      "simpler/faster/more beautiful or scale.</trio_required>"
    )
  }
}
print(json.dumps(result))
PYEOF
fi
