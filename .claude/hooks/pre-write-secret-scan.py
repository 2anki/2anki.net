#!/usr/bin/env python3
"""
PreToolUse → Write/Edit: regex-only scan for hardcoded secrets and obvious
unsafe patterns in the content about to be written.

No LLM calls. No network. Deterministic. Bypass: CLAUDE_SKIP_SAFETY=1 set in the environment at launch (a Write has
no command string to prefix).
"""
import json
import os
import re
import sys


def allow():
    print(json.dumps({"continue": True}))
    sys.exit(0)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


SECRET_PATTERNS = [
    ("AWS access key id",
     re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("AWS secret access key (assignment)",
     re.compile(r"aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*['\"][A-Za-z0-9/+=]{40}['\"]",
                re.IGNORECASE)),
    ("Anthropic API key",
     re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{30,}\b")),
    ("OpenAI API key",
     re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{30,}\b")),
    ("Stripe live secret key",
     re.compile(r"\bsk_live_[A-Za-z0-9]{20,}\b")),
    ("Stripe live publishable key",
     re.compile(r"\bpk_live_[A-Za-z0-9]{20,}\b")),
    ("SendGrid API key",
     re.compile(r"\bSG\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\b")),
    ("GitHub token",
     re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("Google API key",
     re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}\b")),
    ("Slack token",
     re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b")),
    ("PEM private key block",
     re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----")),
    ("Notion integration token",
     re.compile(r"\bsecret_[A-Za-z0-9]{40,}\b")),
    ("Notion ntn token",
     re.compile(r"\bntn_[A-Za-z0-9]{30,}\b")),
    ("JWT-looking literal",
     re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b")),
    ("Generic password assignment",
     re.compile(r"\b(?:password|passwd|pwd)\s*[:=]\s*['\"](?!process\.env|os\.environ|<|\$\{|\{\{)[^'\"]{6,}['\"]",
                re.IGNORECASE)),
]

UNSAFE_PATTERNS = [
    ("knex.raw with template-string interpolation (CWE-89)",
     re.compile(r"knex\.raw\s*\(\s*`[^`]*\$\{")),
    ("child_process exec with template-string (CWE-78)",
     re.compile(r"\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{")),
    ("child_process spawn with shell:true",
     re.compile(r"\bspawn(?:Sync)?\s*\([^)]*shell\s*:\s*true")),
    ("eval() on dynamic input",
     re.compile(r"\beval\s*\(")),
    ("dangerouslySetInnerHTML",
     re.compile(r"dangerouslySetInnerHTML")),
]


def get_content(data):
    name = data.get("tool_name")
    inp = data.get("tool_input", {}) or {}
    if name == "Write":
        return inp.get("file_path", "<unknown>"), inp.get("content", "") or ""
    if name == "Edit":
        return inp.get("file_path", "<unknown>"), inp.get("new_string", "") or ""
    if name == "NotebookEdit":
        return inp.get("notebook_path", "<unknown>"), inp.get("new_source", "") or ""
    return None, None


def is_generated_data_layer(path):
    norm = (path or "").replace("\\", "/")
    return "src/data_layer/public/" in norm


def is_test_or_fixture(path):
    p = path.lower()
    return (
        ".test." in p
        or "/test/" in p
        or "/__tests__/" in p
        or "/fixtures/" in p
        or p.endswith(".env.example")
    )


def main():
    if os.environ.get("CLAUDE_SKIP_SAFETY"):
        allow()

    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        allow()

    if data.get("tool_name") not in ("Write", "Edit", "NotebookEdit"):
        allow()

    path, content = get_content(data)

    if is_generated_data_layer(path):
        deny(
            f"Refusing to write to {path}: this is Kanel-generated code under "
            "src/data_layer/public/.\n"
            "Hand-edits are silently overwritten on the next `pnpm kanel`.\n"
            "Change the migration and re-run `pnpm kanel` to regenerate these types instead.\n"
            "If you genuinely must touch it, relaunch with CLAUDE_SKIP_SAFETY=1 set."
        )

    if content is None or not content.strip():
        allow()

    findings = []
    for label, pat in SECRET_PATTERNS:
        if pat.search(content):
            findings.append(("secret", label))

    if not is_test_or_fixture(path or ""):
        for label, pat in UNSAFE_PATTERNS:
            if pat.search(content):
                findings.append(("unsafe", label))

    if findings:
        bullets = "\n".join(f"  - [{kind}] {label}" for kind, label in findings)
        deny(
            f"Refusing to write to {path}: deterministic scan flagged the following:\n"
            f"{bullets}\n\n"
            "If a finding is a false positive (e.g. example fixture, mock token), move it under\n"
            "a *.test.ts / fixtures/ path, or relaunch with CLAUDE_SKIP_SAFETY=1 set."
        )

    allow()


if __name__ == "__main__":
    main()
