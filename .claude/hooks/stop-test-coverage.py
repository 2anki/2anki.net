#!/usr/bin/env python3
"""
Stop hook: warn if the session left untested source files behind, and warn
if source changed but CLAUDE.md / FEATURE.md was not touched.

Behaviour:
  - Exit 0 with no message if everything looks good.
  - Exit 0 with additionalContext (a soft nudge) for the CLAUDE.md case.
  - Exit 2 (block) only when a NEW source file has no corresponding test
    file — this is the rule from CLAUDE.md.

Bypass: CLAUDE_SKIP_STOP_CHECK=1 (env on the wrapping process).
"""
import json
import os
import re
import subprocess
import sys


DEBUG_ARTIFACT_PATTERNS = [
    ("console.log", re.compile(r"\bconsole\.log\s*\(")),
    ("debugger", re.compile(r"\bdebugger\b")),
]

TEST_ISOLATION_PATTERNS = [
    ("focused test (.only)", re.compile(r"\.only\s*\(")),
    # Line-anchored so the sanctioned env-gate idiom
    # `(RUN_INTEGRATION ? describe : describe.skip)` (mid-expression) passes.
    ("unconditional skip", re.compile(r"^\s*(?:test|it|describe)\.skip\s*\(", re.MULTILINE)),
    ("xdescribe", re.compile(r"\bxdescribe\b")),
    ("xit", re.compile(r"\bxit\b")),
    ("fdescribe", re.compile(r"\bfdescribe\b")),
    ("fit", re.compile(r"\bfit\s*\(")),
]


def quiet_pass():
    sys.exit(0)


def soft_nudge(message):
    print(json.dumps({"systemMessage": message}))
    sys.exit(0)


def block(message):
    sys.stderr.write(message + "\n")
    sys.exit(2)


def run(cmd):
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def changed_files():
    out = run(["git", "status", "--porcelain"])
    if out is None:
        return []
    paths = []
    for line in out.splitlines():
        if not line.strip():
            continue
        # XY <path>  — handle rename "R <old> -> <new>" too.
        rest = line[3:].strip()
        if " -> " in rest:
            rest = rest.split(" -> ", 1)[1]
        paths.append(rest)
    return paths


def is_source(path):
    if not (path.startswith("src/") or path.startswith("web/src/")):
        return False
    if not (path.endswith(".ts") or path.endswith(".tsx")):
        return False
    if path.endswith(".d.ts"):
        return False
    if ".test." in path:
        return False
    if "/migrations/" in path or "/templates/" in path or "/fixtures/" in path:
        return False
    if path.startswith("src/data_layer/public/"):
        return False
    return True


def is_new(path):
    out = run(["git", "status", "--porcelain", "--", path])
    if out is None:
        return False
    return out.lstrip().startswith("??") or out.lstrip().startswith("A")


def expected_test(path):
    if path.endswith(".tsx"):
        return path[:-4] + ".test.tsx"
    return path[:-3] + ".test.ts"


def is_ts_under_src(path):
    if not (path.startswith("src/") or path.startswith("web/src/")):
        return False
    if not (path.endswith(".ts") or path.endswith(".tsx")):
        return False
    return not path.endswith(".d.ts")


def debug_artifacts(changed):
    offenders = []
    for path in changed:
        if not is_ts_under_src(path) or not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                content = handle.read()
        except (OSError, UnicodeDecodeError):
            continue
        is_test = ".test." in path
        patterns = TEST_ISOLATION_PATTERNS if is_test else DEBUG_ARTIFACT_PATTERNS
        hits = [label for label, pat in patterns if pat.search(content)]
        if hits:
            offenders.append((path, hits))
    return offenders


def main():
    if os.environ.get("CLAUDE_SKIP_STOP_CHECK"):
        quiet_pass()

    repo_root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    os.chdir(repo_root)

    changed = changed_files()
    if not changed:
        quiet_pass()

    sources = [p for p in changed if is_source(p)]

    new_without_tests = []
    for src in sources:
        if not is_new(src):
            continue
        test = expected_test(src)
        if not os.path.isfile(test) and test not in changed:
            new_without_tests.append((src, test))

    if new_without_tests:
        bullets = "\n".join(
            f"  - {src} → expected {test}" for src, test in new_without_tests
        )
        block(
            "[stop-hook] Refusing to stop: new source files without colocated tests.\n"
            f"{bullets}\n\n"
            "CLAUDE.md says TDD by default. Add a *.test.ts next to each new file, or\n"
            "if this is genuinely a no-test change, set CLAUDE_SKIP_STOP_CHECK=1."
        )

    nudges = []

    docs_changed = any(
        p == "CLAUDE.md"
        or p.endswith("/CLAUDE.md")
        or p.endswith("/FEATURE.md")
        or p == "FEATURE.md"
        for p in changed
    )
    if sources and not docs_changed:
        sample = ", ".join(sources[:3])
        more = "" if len(sources) <= 3 else f" (+{len(sources) - 3} more)"
        nudges.append(
            f"Source changed this session ({sample}{more}) but no CLAUDE.md or "
            "FEATURE.md was updated. If responsibilities, layering, or constraints "
            "shifted, take a moment to refresh the relevant doc — the next session "
            "starts cold from these files."
        )

    offenders = debug_artifacts(changed)
    if offenders:
        lines = "\n".join(
            f"  - {path}: {', '.join(hits)}" for path, hits in offenders
        )
        nudges.append(
            "Debug/scaffolding artifacts left in changed files — strip before pushing "
            "(code-quality.md, testing.md):\n"
            f"{lines}"
        )

    if nudges:
        soft_nudge("\n\n".join(nudges))

    quiet_pass()


if __name__ == "__main__":
    main()
