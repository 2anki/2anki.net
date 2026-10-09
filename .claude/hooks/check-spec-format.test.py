#!/usr/bin/env python3
import importlib.util
import json
import os
import sys
import unittest
from unittest.mock import patch

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "check_spec_format",
    os.path.join(HOOKS_DIR, "check-spec-format.py"),
)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)


VALID_SPEC = """## Spec: Example feature

**Outcome**: more decks downloaded.
**Goal alignment**: faster — deck downloads, read weekly.
**Problem**: a user hit a wall.
**Riskiest assumption**: users want this.
**Smallest test**: a 1% shadow.
**What this removes**: the old toggle.
**Primary action**: convert.
**Default behavior**: on.
**Surface vocabulary**: matches /upload.
**Scope**: in: X. out: Y.
**User story**: As a user, I want X so that Y.
**Acceptance criteria**:
- [ ] it works
**Open questions**: none.
**Out of scope (next iteration)**: Z.
"""


def make_input(command, tool_name="Bash"):
    return json.dumps({"tool_name": tool_name, "tool_input": {"command": command}})


def run_main(command, tool_name="Bash", root="/repo", paths=None, specs=None):
    captured = {}

    def fake_allow():
        captured["result"] = "allow"
        sys.exit(0)

    def fake_deny(reason):
        captured["result"] = "deny"
        captured["reason"] = reason
        sys.exit(0)

    def fake_read(_root, path):
        return (specs or {}).get(path)

    with patch.object(hook, "allow", side_effect=fake_allow), \
         patch.object(hook, "deny", side_effect=fake_deny), \
         patch.object(hook, "repo_root", return_value=root), \
         patch.object(hook, "staged_spec_files", return_value=paths), \
         patch.object(hook, "read_staged_spec", side_effect=fake_read), \
         patch("sys.stdin") as mock_stdin:
        mock_stdin.read.return_value = make_input(command, tool_name)
        try:
            hook.main()
        except SystemExit:
            pass
    return captured


class HeadingPresenceTest(unittest.TestCase):
    def test_valid_spec_has_every_required_heading(self):
        self.assertEqual(hook.missing_headings(VALID_SPEC), [])

    def test_missing_headings_are_reported(self):
        text = "**Outcome**: x\n**Problem**: y\n"
        missing = hook.missing_headings(text)
        self.assertIn("Acceptance criteria", missing)
        self.assertIn("Scope", missing)
        self.assertNotIn("Outcome", missing)
        self.assertNotIn("Problem", missing)

    def test_markdown_heading_form_counts(self):
        self.assertTrue(hook.heading_present("## Outcome\nmore decks", "Outcome"))

    def test_scope_is_not_satisfied_by_out_of_scope(self):
        out_only = VALID_SPEC.replace("**Scope**: in: X. out: Y.\n", "")
        self.assertIn("Scope", hook.missing_headings(out_only))

    def test_out_of_scope_parenthetical_is_recognized(self):
        self.assertTrue(
            hook.heading_present("**Out of scope (next iteration)**: Z.", "Out of scope")
        )


class ClarificationMarkerTest(unittest.TestCase):
    def test_counts_each_marker(self):
        text = "a [NEEDS CLARIFICATION] b [NEEDS CLARIFICATION: which period?]"
        self.assertEqual(hook.clarification_marker_count(text), 2)

    def test_clean_spec_has_zero(self):
        self.assertEqual(hook.clarification_marker_count(VALID_SPEC), 0)


class GitCommitDetectionTest(unittest.TestCase):
    def test_plain_commit_matches(self):
        self.assertTrue(hook.is_git_commit('git commit -m "docs: add spec"'))

    def test_echo_mentioning_commit_does_not_match(self):
        self.assertFalse(hook.is_git_commit('echo "run git commit later"'))

    def test_amend_is_skipped(self):
        self.assertFalse(hook.is_git_commit("git commit --amend --no-edit"))

    def test_non_commit_allows(self):
        self.assertFalse(hook.is_git_commit("git status"))


class MarkerPhaseTest(unittest.TestCase):
    def test_docs_commit_tolerates_markers(self):
        self.assertTrue(hook.markers_allowed('git commit -m "docs: add spec for X"'))

    def test_feat_commit_forbids_markers(self):
        self.assertFalse(hook.markers_allowed('git commit -m "feat: ship X"'))

    def test_scoped_docs_prefix_tolerates_markers(self):
        self.assertTrue(hook.markers_allowed('git commit -m "docs(specs): draft"'))

    def test_no_detectable_message_defaults_to_tolerant(self):
        self.assertTrue(hook.markers_allowed("git commit"))


class BuildViolationsTest(unittest.TestCase):
    def test_valid_spec_docs_commit_is_clean(self):
        specs = [("Documentation/specs/x.md", VALID_SPEC)]
        self.assertEqual(hook.build_violations('git commit -m "docs: add spec"', specs), [])

    def test_markers_on_docs_commit_tolerated(self):
        with_marker = VALID_SPEC + "\n[NEEDS CLARIFICATION: which limit?]\n"
        specs = [("Documentation/specs/x.md", with_marker)]
        self.assertEqual(hook.build_violations('git commit -m "docs: draft"', specs), [])

    def test_markers_on_feat_commit_flagged(self):
        with_marker = VALID_SPEC + "\n[NEEDS CLARIFICATION: which limit?]\n"
        specs = [("Documentation/specs/x.md", with_marker)]
        violations = hook.build_violations('git commit -m "feat: ship"', specs)
        self.assertEqual(len(violations), 1)
        self.assertIn("NEEDS CLARIFICATION", violations[0])

    def test_missing_heading_flagged_on_any_commit(self):
        specs = [("Documentation/specs/x.md", "**Outcome**: only this")]
        violations = hook.build_violations('git commit -m "docs: draft"', specs)
        self.assertEqual(len(violations), 1)
        self.assertIn("missing required heading", violations[0])


class MainTest(unittest.TestCase):
    def test_non_bash_tool_allows(self):
        self.assertEqual(run_main("git commit", tool_name="Write")["result"], "allow")

    def test_non_commit_allows(self):
        self.assertEqual(run_main("git status")["result"], "allow")

    def test_no_staged_spec_allows(self):
        self.assertEqual(run_main('git commit -m "feat: x"', paths=[])["result"], "allow")

    def test_git_tooling_error_fails_open(self):
        self.assertEqual(run_main('git commit -m "feat: x"', paths=None)["result"], "allow")

    def test_valid_staged_spec_allows(self):
        result = run_main(
            'git commit -m "docs: add spec for X"',
            paths=["Documentation/specs/x.md"],
            specs={"Documentation/specs/x.md": VALID_SPEC},
        )
        self.assertEqual(result["result"], "allow")

    def test_incomplete_staged_spec_denies(self):
        result = run_main(
            'git commit -m "docs: add spec for X"',
            paths=["Documentation/specs/x.md"],
            specs={"Documentation/specs/x.md": "**Outcome**: incomplete"},
        )
        self.assertEqual(result["result"], "deny")

    def test_markers_on_implement_commit_deny(self):
        result = run_main(
            'git commit -m "feat: ship X"',
            paths=["Documentation/specs/x.md"],
            specs={"Documentation/specs/x.md": VALID_SPEC + "\n[NEEDS CLARIFICATION: ?]"},
        )
        self.assertEqual(result["result"], "deny")

    def test_bypass_env_allows(self):
        with patch.dict(os.environ, {"CLAUDE_SKIP_SPEC_CHECK": "1"}):
            result = run_main(
                'git commit -m "docs: add spec"',
                paths=["Documentation/specs/x.md"],
                specs={"Documentation/specs/x.md": "**Outcome**: incomplete"},
            )
        self.assertEqual(result["result"], "allow")


if __name__ == "__main__":
    unittest.main()
