#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch, MagicMock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "check_removed_for_users",
    os.path.join(HOOKS_DIR, "check-removed-for-users.py"),
)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)


EN_LOCALE = "web/src/lib/i18n/locales/en/anonymousPartial.json"
DE_LOCALE = "web/src/lib/i18n/locales/de/anonymousPartial.json"
EN_OTHER = "web/src/lib/i18n/locales/en/monthlyPartial.json"
PARSER_SNAP = "src/lib/parser/golden/__snapshots__/conversionGolden.test.ts.snap"
RENDER_SNAP = "src/lib/notion-render/golden/__snapshots__/renderBlocksGolden.test.ts.snap"
NOTICE = "web/src/components/AnonymousPartialNotice/AnonymousPartialNotice.tsx"
WARNING_SRC = "src/lib/claude/aiCredits/uploadWarning.ts"


def make_input(command, tool_name="Bash"):
    return json.dumps({"tool_name": tool_name, "tool_input": {"command": command}})


def file_entry(path, change_type="MODIFIED", deletions=1):
    return {"path": path, "changeType": change_type, "additions": 1, "deletions": deletions}


def pr_json(files, body="", author="alemayhu"):
    return json.dumps({"author": {"login": author}, "body": body, "files": files})


def diff_block(path, removed=(), added=(), deleted_file=False):
    lines = [
        f"diff --git a/{path} b/{path}",
        "index 1111111..2222222 100644",
        f"--- a/{path}",
        "+++ /dev/null" if deleted_file else f"+++ b/{path}",
        "@@ -1,4 +1,4 @@",
        " {",
    ]
    lines.extend(f"-{line}" for line in removed)
    lines.extend(f"+{line}" for line in added)
    lines.append(" }")
    return "\n".join(lines) + "\n"


def gh_responder(view_stdout, diff_stdout="", diff_returncode=0, view_returncode=0):
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[:3] == ["gh", "pr", "view"]:
            return MagicMock(returncode=view_returncode, stdout=view_stdout, stderr="boom")
        if args[:3] == ["gh", "pr", "diff"]:
            return MagicMock(returncode=diff_returncode, stdout=diff_stdout, stderr="too large")
        raise AssertionError(f"unexpected command {args}")

    fake_run.calls = calls
    return fake_run


def run_hook(command, fake_run=None, tool_name="Bash"):
    captured = {}

    def fake_allow():
        captured["result"] = "allow"
        sys.exit(0)

    def fake_deny(reason):
        captured["result"] = "deny"
        captured["reason"] = reason
        sys.exit(0)

    with patch.object(hook, "allow", side_effect=fake_allow), \
         patch.object(hook, "deny", side_effect=fake_deny), \
         patch("sys.stdin") as mock_stdin:
        mock_stdin.read.return_value = make_input(command, tool_name)
        if fake_run is None:
            try:
                hook.main()
            except SystemExit:
                pass
        else:
            with patch("subprocess.run", side_effect=fake_run):
                try:
                    hook.main()
                except SystemExit:
                    pass
    return captured


REMOVED_KEY_DIFF = diff_block(
    EN_LOCALE,
    removed=[
        '  "headline": "Your first 21 cards are ready",',
        '  "heldBack_other": "{{count}} more cards are not in this download",',
    ],
    added=['  "headline": "Your first {{count}} cards are ready",'],
)

RENAMED_KEY_DIFF = diff_block(
    EN_LOCALE,
    removed=['  "heldBack_other": "{{count}} more cards are not in this download"'],
) + diff_block(
    EN_OTHER,
    removed=[],
    added=['  "heldBackCount_other": "{{count}} more cards are not in this download"'],
)


class TestPassthrough(unittest.TestCase):
    def test_non_merge_command_allows_without_gh(self):
        self.assertEqual(run_hook("git status")["result"], "allow")

    def test_non_bash_tool_allows(self):
        self.assertEqual(run_hook("gh pr merge 1", tool_name="Edit")["result"], "allow")

    def test_merge_mentioned_in_commit_message_allows(self):
        self.assertEqual(
            run_hook('git commit -m "docs: explain gh pr merge"')["result"], "allow"
        )

    def test_unrelated_files_allow_without_fetching_diff(self):
        fake = gh_responder(pr_json([file_entry("web/src/App.tsx"), file_entry("README.md")]))
        self.assertEqual(run_hook("gh pr merge 12 --squash", fake)["result"], "allow")
        self.assertFalse(any(c[:3] == ["gh", "pr", "diff"] for c in fake.calls))

    def test_dependabot_is_exempt(self):
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP)], author="dependabot[bot]"))
        self.assertEqual(run_hook("gh pr merge 12", fake)["result"], "allow")


class TestRemovedTranslatedStrings(unittest.TestCase):
    def test_deleted_en_key_denies_without_section(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), REMOVED_KEY_DIFF)
        result = run_hook("gh pr merge 4589 --squash", fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("anonymousPartial.json: heldBack_other", result["reason"])
        self.assertIn("## Removed for users", result["reason"])

    def test_value_change_on_same_key_is_not_a_removal(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), REMOVED_KEY_DIFF)
        result = run_hook("gh pr merge 4589", fake)
        self.assertNotIn("anonymousPartial.json: headline", result["reason"])

    def test_renamed_key_with_same_value_allows(self):
        fake = gh_responder(
            pr_json([file_entry(EN_LOCALE), file_entry(EN_OTHER, "ADDED", 0)]),
            RENAMED_KEY_DIFF,
        )
        self.assertEqual(run_hook("gh pr merge 7", fake)["result"], "allow")

    def test_removal_in_non_source_locale_only_allows(self):
        diff = diff_block(DE_LOCALE, removed=['  "cta": "Kostenloses Konto erstellen"'])
        fake = gh_responder(pr_json([file_entry(DE_LOCALE)]), diff)
        self.assertEqual(run_hook("gh pr merge 7", fake)["result"], "allow")

    def test_section_with_content_allows(self):
        body = (
            "## What\nstuff\n\n## Removed for users\n"
            "Signed-in free users no longer see how many cards were held back.\n\n"
            "## Risks\nnone\n"
        )
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook("gh pr merge 4589", fake)["result"], "allow")

    def test_empty_section_denies(self):
        body = "## Removed for users\n\n<!-- fill me -->\n\n## Risks\nnone\n"
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook("gh pr merge 4589", fake)["result"], "deny")

    def test_bare_none_denies(self):
        body = "## Removed for users\nNone.\n"
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook("gh pr merge 4589", fake)["result"], "deny")

    def test_none_with_reason_allows(self):
        body = "## Removed for users\nNone, the strings moved to the gate component.\n"
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook("gh pr merge 4589", fake)["result"], "allow")

    def test_diff_fetch_error_fails_open(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), "", diff_returncode=1)
        self.assertEqual(run_hook("gh pr merge 4589", fake)["result"], "allow")


class TestRemovedNoticeComponents(unittest.TestCase):
    def test_deleted_notice_component_denies(self):
        fake = gh_responder(pr_json([file_entry(NOTICE, "DELETED", 58)]))
        result = run_hook("gh pr merge 4589", fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(NOTICE, result["reason"])

    def test_deleted_notice_test_and_css_allow(self):
        fake = gh_responder(pr_json([
            file_entry(NOTICE.replace(".tsx", ".test.tsx"), "DELETED"),
            file_entry(NOTICE.replace(".tsx", ".module.css"), "DELETED"),
        ]))
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")

    def test_moved_notice_component_allows(self):
        fake = gh_responder(pr_json([
            file_entry(NOTICE, "DELETED", 58),
            file_entry("web/src/components/upload/AnonymousPartialNotice.tsx", "ADDED", 0),
        ]))
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")

    def test_deleted_non_notice_component_allows(self):
        fake = gh_responder(pr_json([file_entry("web/src/components/Spinner/Spinner.tsx", "DELETED")]))
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")


class TestRemovedServerWarnings(unittest.TestCase):
    def test_deleted_warning_constant_denies(self):
        diff = diff_block(
            WARNING_SRC,
            removed=["export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';"],
        )
        fake = gh_responder(pr_json([file_entry(WARNING_SRC)]), diff)
        result = run_hook("gh pr merge 1", fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("AI_CREDITS_EXHAUSTED_WARNING_CODE", result["reason"])

    def test_moved_warning_constant_allows(self):
        diff = diff_block(
            WARNING_SRC,
            removed=["export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';"],
        ) + diff_block(
            "src/lib/upload/warningCodes.ts",
            added=["export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';"],
        )
        fake = gh_responder(
            pr_json([file_entry(WARNING_SRC), file_entry("src/lib/upload/warningCodes.ts", "ADDED", 0)]),
            diff,
        )
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")

    def test_warning_constant_in_test_file_allows(self):
        path = "src/lib/claude/aiCredits/uploadWarning.test.ts"
        diff = diff_block(path, removed=["const FAKE_WARNING = 'x';"])
        fake = gh_responder(pr_json([file_entry(path)]), diff)
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")


class TestSnapshotChanges(unittest.TestCase):
    def test_modified_golden_snapshot_denies(self):
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP)]))
        result = run_hook("gh pr merge 1", fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(PARSER_SNAP, result["reason"])
        self.assertIn("## Snapshot changes", result["reason"])

    def test_golden_test_source_change_allows(self):
        fake = gh_responder(pr_json([file_entry("src/lib/parser/golden/conversionGolden.test.ts")]))
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")

    def test_section_naming_each_snapshot_allows(self):
        body = (
            "## Snapshot changes\n"
            "- conversionGolden.test.ts.snap: toggle cards keep their trailing image.\n"
            "- renderBlocksGolden.test.ts.snap: callouts render with the icon span.\n"
        )
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP), file_entry(RENDER_SNAP)], body))
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")

    def test_section_missing_one_snapshot_denies(self):
        body = "## Snapshot changes\n- conversionGolden.test.ts.snap: toggle cards keep their image.\n"
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP), file_entry(RENDER_SNAP)], body))
        result = run_hook("gh pr merge 1", fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(RENDER_SNAP, result["reason"])
        self.assertNotIn(f"  {PARSER_SNAP}", result["reason"])

    def test_snapshot_section_does_not_cover_removed_strings(self):
        body = "## Snapshot changes\n- conversionGolden.test.ts.snap: image kept.\n"
        fake = gh_responder(
            pr_json([file_entry(PARSER_SNAP), file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF
        )
        result = run_hook("gh pr merge 1", fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("## Removed for users", result["reason"])


class TestFailOpen(unittest.TestCase):
    def test_gh_view_nonzero_allows(self):
        fake = gh_responder("", view_returncode=1)
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")

    def test_gh_missing_allows(self):
        self.assertEqual(
            run_hook("gh pr merge 1", fake_run=FileNotFoundError("gh"))["result"], "allow"
        )

    def test_gh_timeout_allows(self):
        self.assertEqual(
            run_hook("gh pr merge 1", fake_run=subprocess.TimeoutExpired("gh", 15))["result"],
            "allow",
        )

    def test_gh_bad_json_allows(self):
        fake = gh_responder("not json")
        self.assertEqual(run_hook("gh pr merge 1", fake)["result"], "allow")


class TestPrRefPassing(unittest.TestCase):
    def test_pr_number_reaches_view_and_diff(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), REMOVED_KEY_DIFF)
        run_hook("gh pr merge 4589 --squash", fake)
        self.assertEqual(fake.calls[0][:4], ["gh", "pr", "view", "4589"])
        self.assertEqual(fake.calls[1][:4], ["gh", "pr", "diff", "4589"])


if __name__ == "__main__":
    unittest.main()
