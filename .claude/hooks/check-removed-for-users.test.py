#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import sys
import time
import tracemalloc
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


GH_PR_VIEW_FILES_CAP = 100
REST_STATUS = {"ADDED": "added", "DELETED": "removed", "MODIFIED": "modified", "RENAMED": "renamed"}
REST_FAILURE = {"returncode": 1, "stdout": "", "stderr": "HTTP 502"}
MERGE_1 = "gh pr merge 1 --repo 2anki/server --squash"
MERGE_4589 = "gh pr merge 4589 --repo 2anki/server --squash"
REJECTED_FORMS = (
    "gh pr merge 1",
    "gh pr merge --squash",
    "gh pr merge some-branch --repo 2anki/server --squash",
    "gh pr merge #1 --repo 2anki/server --squash",
    'gh pr merge "1" --repo 2anki/server --squash',
    "gh pr merge 1 -sR other/repo",
    "gh pr -R other/repo merge 1",
    "gh pr merge 1 --squash --repo 2anki/server; true",
    "gh pr merge 1 --repo other/repo --squash",
    "gh pr merge https://github.com/2anki/server/pull/1 --repo 2anki/server --squash",
    "GH_REPO=other/repo gh pr merge 1 --repo 2anki/server --squash",
    "cd /tmp/other && gh pr merge 1 --repo 2anki/server --squash",
    "gh api -X PUT repos/2anki/2anki.net/pulls/1/merge",
)


def pr_json(files, body="", author="alemayhu"):
    return json.dumps({
        "number": 4589,
        "author": {"login": author},
        "body": body,
        "files": files[:GH_PR_VIEW_FILES_CAP],
    })


def rest_stdout(files):
    return "".join(
        json.dumps([f["path"], REST_STATUS[f["changeType"]], f["additions"], f["deletions"]]) + "\n"
        for f in files
    )


def view_files(view_stdout):
    try:
        files = json.loads(view_stdout).get("files")
    except (ValueError, AttributeError):
        return []
    listable = ("path", "changeType", "additions", "deletions")
    if not isinstance(files, list):
        return []
    return [f for f in files if isinstance(f, dict) and all(f.get(k) is not None for k in listable)]


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


def viewed_as(view_stdout, args):
    try:
        parsed = json.loads(view_stdout)
    except ValueError:
        return view_stdout
    if not isinstance(parsed, dict) or "number" not in parsed:
        return view_stdout
    number = args[3] if len(args) > 3 and args[3].isdigit() else parsed["number"]
    parsed.setdefault("url", f"https://github.com/2anki/2anki.net/pull/{number}")
    parsed["number"] = int(number)
    return json.dumps(parsed)


def gh_responder(view_stdout, diff_stdout="", diff_returncode=0, view_returncode=0, rest_files=None, rest_result=None):
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[:3] == ["gh", "pr", "view"]:
            return MagicMock(returncode=view_returncode, stdout=viewed_as(view_stdout, args), stderr="boom")
        if args[:2] == ["gh", "api"]:
            if rest_result is not None:
                return MagicMock(**rest_result)
            listed = view_files(view_stdout) if rest_files is None else rest_files
            return MagicMock(returncode=0, stdout=rest_stdout(listed), stderr="")
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
        self.assertEqual(run_hook(MERGE_1, tool_name="Edit")["result"], "allow")

    def test_merge_mentioned_in_commit_message_allows(self):
        self.assertEqual(
            run_hook('git commit -m "docs: explain gh pr merge"')["result"], "allow"
        )

    def test_unrelated_files_allow_without_fetching_diff(self):
        fake = gh_responder(pr_json([file_entry("web/src/App.tsx"), file_entry("README.md")]))
        self.assertEqual(run_hook("gh pr merge 12 --repo 2anki/server --squash", fake)["result"], "allow")
        self.assertFalse(any(c[:3] == ["gh", "pr", "diff"] for c in fake.calls))

    def test_dependabot_is_exempt_under_both_login_spellings(self):
        for login in ("app/dependabot", "dependabot[bot]"):
            fake = gh_responder(pr_json([file_entry(PARSER_SNAP)], author=login))
            self.assertEqual(run_hook("gh pr merge 12 --repo 2anki/server --squash", fake)["result"], "allow", login)


class TestRemovedTranslatedStrings(unittest.TestCase):
    def test_deleted_en_key_denies_without_section(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), REMOVED_KEY_DIFF)
        result = run_hook(MERGE_4589, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("anonymousPartial.json: heldBack_other", result["reason"])
        self.assertIn("## Removed for users", result["reason"])

    def test_value_change_on_same_key_is_not_a_removal(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), REMOVED_KEY_DIFF)
        result = run_hook(MERGE_4589, fake)
        self.assertNotIn("anonymousPartial.json: headline", result["reason"])

    def test_renamed_key_with_same_value_allows(self):
        fake = gh_responder(
            pr_json([file_entry(EN_LOCALE), file_entry(EN_OTHER, "ADDED", 0)]),
            RENAMED_KEY_DIFF,
        )
        self.assertEqual(run_hook("gh pr merge 7 --repo 2anki/server --squash", fake)["result"], "allow")

    def test_removal_in_non_source_locale_only_allows(self):
        diff = diff_block(DE_LOCALE, removed=['  "cta": "Kostenloses Konto erstellen"'])
        fake = gh_responder(pr_json([file_entry(DE_LOCALE)]), diff)
        self.assertEqual(run_hook("gh pr merge 7 --repo 2anki/server --squash", fake)["result"], "allow")

    def test_section_with_content_allows(self):
        body = (
            "## What\nstuff\n\n## Removed for users\n"
            "Signed-in free users no longer see how many cards were held back.\n\n"
            "## Risks\nnone\n"
        )
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook(MERGE_4589, fake)["result"], "allow")

    def test_empty_section_denies(self):
        body = "## Removed for users\n\n<!-- fill me -->\n\n## Risks\nnone\n"
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook(MERGE_4589, fake)["result"], "deny")

    def test_bare_none_denies(self):
        body = "## Removed for users\nNone.\n"
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook(MERGE_4589, fake)["result"], "deny")

    def test_none_with_reason_allows(self):
        body = "## Removed for users\nNone, the strings moved to the gate component.\n"
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook(MERGE_4589, fake)["result"], "allow")

    def test_diff_fetch_error_fails_open(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), "", diff_returncode=1)
        self.assertEqual(run_hook(MERGE_4589, fake)["result"], "allow")


class TestRemovedNoticeComponents(unittest.TestCase):
    def test_deleted_notice_component_denies(self):
        fake = gh_responder(pr_json([file_entry(NOTICE, "DELETED", 58)]))
        result = run_hook(MERGE_4589, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(NOTICE, result["reason"])

    def test_deleted_notice_test_and_css_allow(self):
        fake = gh_responder(pr_json([
            file_entry(NOTICE.replace(".tsx", ".test.tsx"), "DELETED"),
            file_entry(NOTICE.replace(".tsx", ".module.css"), "DELETED"),
        ]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_moved_notice_component_allows(self):
        fake = gh_responder(pr_json([
            file_entry(NOTICE, "DELETED", 58),
            file_entry("web/src/components/upload/AnonymousPartialNotice.tsx", "ADDED", 0),
        ]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_deleted_non_notice_component_allows(self):
        fake = gh_responder(pr_json([file_entry("web/src/components/Spinner/Spinner.tsx", "DELETED")]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")


class TestRemovedServerWarnings(unittest.TestCase):
    def test_deleted_warning_constant_denies(self):
        diff = diff_block(
            WARNING_SRC,
            removed=["export const AI_CREDITS_EXHAUSTED_WARNING_CODE = 'ai-credits-exhausted';"],
        )
        fake = gh_responder(pr_json([file_entry(WARNING_SRC)]), diff)
        result = run_hook(MERGE_1, fake)
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
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_warning_constant_in_test_file_allows(self):
        path = "src/lib/claude/aiCredits/uploadWarning.test.ts"
        diff = diff_block(path, removed=["const FAKE_WARNING = 'x';"])
        fake = gh_responder(pr_json([file_entry(path)]), diff)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")


class TestSnapshotChanges(unittest.TestCase):
    def test_modified_golden_snapshot_denies(self):
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP)]))
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(PARSER_SNAP, result["reason"])
        self.assertIn("## Snapshot changes", result["reason"])

    def test_golden_test_source_change_allows(self):
        fake = gh_responder(pr_json([file_entry("src/lib/parser/golden/conversionGolden.test.ts")]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_section_naming_each_snapshot_allows(self):
        body = (
            "## Snapshot changes\n"
            "- conversionGolden.test.ts.snap: toggle cards keep their trailing image.\n"
            "- renderBlocksGolden.test.ts.snap: callouts render with the icon span.\n"
        )
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP), file_entry(RENDER_SNAP)], body))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_section_missing_one_snapshot_denies(self):
        body = "## Snapshot changes\n- conversionGolden.test.ts.snap: toggle cards keep their image.\n"
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP), file_entry(RENDER_SNAP)], body))
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(RENDER_SNAP, result["reason"])
        self.assertNotIn(f"  {PARSER_SNAP}", result["reason"])

    def test_snapshot_section_does_not_cover_removed_strings(self):
        body = "## Snapshot changes\n- conversionGolden.test.ts.snap: image kept.\n"
        fake = gh_responder(
            pr_json([file_entry(PARSER_SNAP), file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF
        )
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("## Removed for users", result["reason"])


class TestFailedView(unittest.TestCase):
    def test_a_failed_view_denies_the_merge(self):
        for fake in (
            gh_responder("", view_returncode=1),
            gh_responder("not json"),
            gh_responder("[]"),
            FileNotFoundError("gh"),
            PermissionError("gh"),
            subprocess.TimeoutExpired("gh", hook.GH_TIMEOUT_SECONDS),
        ):
            result = run_hook(MERGE_1, fake_run=fake)
            self.assertEqual(result["result"], "deny", fake)
            self.assertIn("could not read PR 1", result["reason"])


class TestPrRefPassing(unittest.TestCase):
    def test_the_matched_repo_reaches_view_and_diff(self):
        for command, repo in ((MERGE_4589, "2anki/server"), ("gh pr merge 4589 --repo 2anki/2anki.net --squash", "2anki/2anki.net")):
            fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), REMOVED_KEY_DIFF)
            run_hook(command, fake)
            self.assertEqual(fake.calls[0][:6], ["gh", "pr", "view", "4589", "-R", repo])
            self.assertEqual(fake.calls[1][:4], ["gh", "api", "--paginate", "repos/2anki/2anki.net/pulls/4589/files?per_page=100"])
            self.assertEqual(fake.calls[2][:6], ["gh", "pr", "diff", "4589", "-R", repo])


FILLER = [file_entry(f"docs/page{i}.md") for i in range(150)]


class TestFilesPastTheFirst100(unittest.TestCase):
    def test_deleted_notice_component_past_the_first_100_files_denies(self):
        files = FILLER + [file_entry(NOTICE, "DELETED")]
        fake = gh_responder(pr_json(files), rest_files=files)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(NOTICE, result["reason"])

    def test_notice_component_surviving_past_the_first_100_files_is_a_move(self):
        moved = "web/src/components/Moved/AnonymousPartialNotice.tsx"
        files = [file_entry(NOTICE, "DELETED")] + FILLER + [file_entry(moved, "ADDED", 0)]
        fake = gh_responder(pr_json(files), rest_files=files)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_changed_snapshot_past_the_first_100_files_denies(self):
        files = FILLER + [file_entry(PARSER_SNAP)]
        fake = gh_responder(pr_json(files), rest_files=files)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(PARSER_SNAP, result["reason"])

    def test_removed_en_string_past_the_first_100_files_denies(self):
        files = FILLER + [file_entry(EN_LOCALE)]
        fake = gh_responder(pr_json(files), REMOVED_KEY_DIFF, rest_files=files)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("heldBack_other", result["reason"])


class TestMergeForm(unittest.TestCase):
    def test_every_other_merge_form_is_denied_without_calling_gh(self):
        for command in REJECTED_FORMS:
            fake = gh_responder(pr_json([file_entry(EN_LOCALE)]))
            result = run_hook(command, fake)
            self.assertEqual(result["result"], "deny", command)
            self.assertIn("gh pr merge <n> --repo 2anki/server --squash", result["reason"])
            self.assertEqual(fake.calls, [])


class TestViewMismatch(unittest.TestCase):
    def test_a_view_resolving_another_repo_is_denied(self):
        view = json.dumps({**json.loads(pr_json([])), "url": "https://github.com/someone/fork/pull/4589"})
        result = run_hook(MERGE_4589, gh_responder(view))
        self.assertEqual(result["result"], "deny")
        self.assertIn("someone/fork", result["reason"])

    def test_a_view_resolving_another_pr_is_denied(self):
        view = json.dumps({**json.loads(pr_json([])), "url": "https://github.com/2anki/2anki.net/pull/9"})
        self.assertEqual(run_hook(MERGE_4589, gh_responder(view))["result"], "deny")


class TestRestFailure(unittest.TestCase):
    def test_rest_failure_still_gates_a_notice_component_in_the_first_100_files(self):
        files = [file_entry(NOTICE, "DELETED")] + FILLER
        fake = gh_responder(pr_json(files), rest_result=REST_FAILURE)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "deny")

    def test_rest_failure_falls_back_to_the_first_100_files_as_before(self):
        files = FILLER + [file_entry(NOTICE, "DELETED")]
        fake = gh_responder(pr_json(files), rest_result=REST_FAILURE)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_rest_os_error_still_gates_a_snapshot_in_the_first_100_files(self):
        view = MagicMock(returncode=0, stdout=pr_json([file_entry(PARSER_SNAP)] + FILLER), stderr="")
        result = run_hook(MERGE_1, fake_run=[view, PermissionError("gh")])
        self.assertEqual(result["result"], "deny")


def nested_hunk(path, lines):
    header = [
        f"diff --git a/{path} b/{path}",
        "index 1111111..2222222 100644",
        f"--- a/{path}",
        f"+++ b/{path}",
        "@@ -10,8 +10,8 @@",
    ]
    return "\n".join(header + lines) + "\n"


NESTED_BLOCK_SWAP = nested_hunk(EN_LOCALE, [
    '   "intro": "Hello",',
    '-  "notice": {',
    '-    "title": "You have 5 cards held back"',
    '-  },',
    '+  "gate": {',
    '+    "title": "Sign up"',
    '+  },',
    '   "outro": "Bye"',
])

NESTED_COPY_EDIT = nested_hunk(EN_LOCALE, [
    '   "notice": {',
    '-    "title": "You have 5 cards held back"',
    '+    "title": "5 cards are waiting for you"',
    '   },',
])


class TestNestedLocaleKeys(unittest.TestCase):
    def test_replacing_a_nested_block_with_a_same_leaf_key_denies(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), NESTED_BLOCK_SWAP)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("anonymousPartial.json: notice.title", result["reason"])

    def test_copy_edit_inside_a_nested_block_allows(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), NESTED_COPY_EDIT)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")


class TestDiffParsing(unittest.TestCase):
    def test_deleted_en_file_denies(self):
        diff = diff_block(EN_LOCALE, removed=['  "cta": "Create a free account"'], deleted_file=True)
        fake = gh_responder(pr_json([file_entry(EN_LOCALE, "DELETED")]), diff)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("anonymousPartial.json: cta", result["reason"])

    def test_hunk_lines_that_look_like_headers_are_content(self):
        diff = nested_hunk(WARNING_SRC, ["--- separator", "+++ separator", " context"])
        hunks = hook.parse_hunks(diff)
        self.assertEqual(
            hunks[0]["lines"],
            [("-", "-- separator"), ("+", "++ separator"), (" ", "context")],
        )

    def test_files_without_deletions_skip_the_diff_fetch(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE, "MODIFIED", 0)]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")
        self.assertFalse(any(c[:3] == ["gh", "pr", "diff"] for c in fake.calls))

    def test_removed_lines_over_the_length_cap_are_skipped(self):
        long_line = '  "long": "' + "v" * hook.MAX_LINE_LENGTH + '"'
        diff = diff_block(EN_LOCALE, removed=[long_line, '  "short": "gone"'])
        findings = hook.removed_locale_strings(hook.parse_hunks(diff))
        self.assertEqual(findings, ['anonymousPartial.json: short ("gone")'])

    def test_trailing_whitespace_line_matches_in_linear_time(self):
        line = '  "k": "v"' + " " * 200000 + "x"
        started = time.monotonic()
        self.assertIsNone(hook.LOCALE_ENTRY.match(line.rstrip()))
        self.assertLess(time.monotonic() - started, 0.5)


class TestFileListEdges(unittest.TestCase):
    def test_renamed_notice_component_allows(self):
        fake = gh_responder(pr_json([file_entry(NOTICE, "RENAMED", 0)]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_added_golden_snapshot_allows(self):
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP, "ADDED", 0)]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_add_only_edit_to_existing_snapshot_allows(self):
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP, "MODIFIED", 0)]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_snapshot_names_split_across_two_sections_allow(self):
        body = (
            "## Snapshot changes\n- conversionGolden.test.ts.snap: image kept.\n\n## Risks\nx\n"
            "## Snapshot changes\n- renderBlocksGolden.test.ts.snap: icon span added.\n"
        )
        fake = gh_responder(pr_json([file_entry(PARSER_SNAP), file_entry(RENDER_SNAP)], body))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_null_author_still_runs_the_gate(self):
        payload = json.dumps({"author": None, "body": "", "files": [file_entry(PARSER_SNAP)]})
        self.assertEqual(run_hook(MERGE_1, gh_responder(payload))["result"], "deny")


class TestSectionParsing(unittest.TestCase):
    def deny_or_allow(self, body):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        return run_hook(MERGE_1, fake)["result"]

    def test_crlf_body_with_filled_section_allows(self):
        body = "## What\r\nx\r\n\r\n## Removed for users\r\nFree users lose the held-back count.\r\n"
        self.assertEqual(self.deny_or_allow(body), "allow")

    def test_section_at_end_without_newline_allows(self):
        self.assertEqual(self.deny_or_allow("## Removed for users\nFree users lose the count."), "allow")

    def test_subheading_stays_inside_the_section(self):
        body = "## Removed for users\n### Upload page\nFree users lose the count.\n## Risks\nx\n"
        self.assertEqual(self.deny_or_allow(body), "allow")

    def test_heading_inside_html_comment_does_not_count(self):
        body = "<!--\n## Removed for users\nexplain here\n-->\n## Risks\nx\n"
        self.assertEqual(self.deny_or_allow(body), "deny")

    def test_unclosed_html_comment_hides_the_rest(self):
        body = "<!-- " * 20000 + "\n## Removed for users\nFree users lose the count.\n"
        self.assertEqual(self.deny_or_allow(body), "deny")

    def test_unedited_template_denies(self):
        self.assertEqual(self.deny_or_allow("## Removed for users\nNone, <why>\n"), "deny")

    def test_nothing_removed_denies(self):
        self.assertEqual(self.deny_or_allow("## Removed for users\nNothing removed.\n"), "deny")

    def test_no_user_facing_changes_denies(self):
        self.assertEqual(self.deny_or_allow("## Removed for users\nNo user-facing changes.\n"), "deny")

    def test_ticked_checkbox_none_denies(self):
        self.assertEqual(self.deny_or_allow("## Removed for users\n- [x] None\n"), "deny")

    def test_heading_with_trailing_colon_allows(self):
        self.assertEqual(self.deny_or_allow("## Removed for users:\nFree users lose the count.\n"), "allow")

    def test_placeholder_followed_by_for_users_denies(self):
        self.assertEqual(self.deny_or_allow("## Removed for users\nNone removed for users.\n"), "deny")

    def test_any_filled_copy_of_the_heading_counts(self):
        body = "## Removed for users\n\n## Risks\nx\n## Removed for users\nFree users lose the count.\n"
        self.assertEqual(self.deny_or_allow(body), "allow")


MOVE_AND_REWORD = nested_hunk(EN_LOCALE, [
    '   "nav": {',
    '+    "favorites": "Saved decks",',
    '     "home": "Home",',
]) + "\n".join([
    "@@ -40,4 +41,3 @@",
    '     "search": "Search",',
    '-    "favorites": "Favorites",',
    '     "help": "Help"',
]) + "\n"

DEEP_NESTING = nested_hunk(EN_LOCALE, [
    *[f' {"  " * depth}"k{depth}": {{' for depth in range(1, 40)],
    f'-{"  " * 40}"leaf": "gone"',
])


NESTED_TO_FLAT = nested_hunk(EN_LOCALE, [
    '   "intro": "Hello",',
    '-  "notice": {',
    '-    "title": "You have 5 cards held back",',
    '-    "body": "Upgrade to get them"',
    '-  },',
    '+  "title": "Sign up",',
    '+  "body": "Create a free account",',
    '   "outro": "Bye"',
])

FLAT_TO_NESTED = nested_hunk(EN_LOCALE, [
    '   "intro": "Hello",',
    '-  "title": "You have 5 cards held back",',
    '+  "gate": {',
    '+    "title": "Sign up"',
    '+  },',
    '   "outro": "Bye"',
])


class TestBoundedWork(unittest.TestCase):
    def assert_fast(self, func, limit_seconds=2.0):
        started = time.monotonic()
        func()
        self.assertLess(time.monotonic() - started, limit_seconds)

    def test_many_removed_and_added_keys_match_in_linear_time(self):
        openers = [f' {"  " * depth}"{"o" * 3900}{depth}": {{' for depth in range(1, 17)]
        removed = [f'-{"  " * 17}"r{n}": "old {n}",' for n in range(4500)]
        added = [f'+{"  " * 17}"a{n}": "new {n}",' for n in range(4500)]
        hunks = hook.parse_hunks(nested_hunk(EN_LOCALE, openers + removed + added))
        findings = []
        self.assert_fast(lambda: findings.extend(hook.removed_locale_strings(hunks)))
        self.assertEqual(len(findings), 4500)

    def test_opener_keys_are_length_capped(self):
        diff = nested_hunk(EN_LOCALE, [f' "{"o" * 3900}": {{', '-  "leaf": "gone"'])
        removed = hook.locale_entries(hook.parse_hunks(diff)[0]["lines"], "-")
        self.assertEqual(len(removed[0][0]), hook.MAX_KEY_LENGTH + len(".leaf"))

    def test_heading_with_long_trailing_whitespace_parses_in_linear_time(self):
        body = "## Removed for users" + " " * 65000 + "x\n"
        self.assert_fast(lambda: hook.filled_sections(body, hook.REMOVED_SECTION), 0.5)

    def assert_peak_memory_below(self, func, limit_bytes):
        tracemalloc.start()
        try:
            func()
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, limit_bytes)

    def test_many_distinct_keys_under_long_openers_stay_within_memory(self):
        openers = [f' {" " * depth}"{"o" * 80}": {{' for depth in range(8)]
        added = [f'+{" " * 8}"k{n}":""' for n in range(110_000)]
        hunks = hook.parse_hunks(nested_hunk(EN_LOCALE, openers + added))
        self.assert_peak_memory_below(lambda: hook.removed_locale_strings(hunks), 50_000_000)

    def test_long_paths_do_not_multiply_finding_memory(self):
        long_path = "src/" + "d" * 25000 + "/warnings.ts"
        removed = [f"-const W{n}_WARNING = 1" for n in range(80_000)]
        hunks = hook.parse_hunks(nested_hunk(long_path, removed))
        findings = []
        self.assert_peak_memory_below(lambda: findings.extend(hook.removed_server_warnings(hunks)), 100_000_000)
        self.assertEqual(len(findings), 80_000)
        self.assertLessEqual(len(findings[0]), 2 * hook.MAX_ITEM_LENGTH + 2)

    def test_entry_budget_fails_closed(self):
        removed = [f'-  "r{n}": "old {n}",' for n in range(hook.MAX_LOCALE_ENTRIES + 1)]
        hunks = hook.parse_hunks(nested_hunk(EN_LOCALE, removed))
        self.assertTrue(hook.removed_locale_strings(hunks) == hook.too_many_locale_entries())

    def test_diff_size_is_measured_in_bytes(self):
        emoji_diff = REMOVED_KEY_DIFF + "\U0001F600" * (hook.MAX_DIFF_BYTES // 4 + 1)
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), emoji_diff)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_dotted_keys_keep_suffix_work_bounded(self):
        dotted = "." * 197
        openers = [f' {"  " * depth}"{dotted}{depth}": {{' for depth in range(1, 17)]
        added = [f'+{"  " * 17}"{dotted}a{n}": "new {n}",' for n in range(1000)]
        removed = [f'-{"  " * 17}"{dotted}r{n}": "old {n}",' for n in range(1000)]
        hunks = hook.parse_hunks(nested_hunk(EN_LOCALE, openers + added + removed))
        entries = hook.locale_entries(hunks[0]["lines"], "+")
        self.assertLessEqual(len(hook.dotted_suffixes(entries[0][0])), hook.MAX_KEY_DEPTH + 1)
        self.assert_fast(lambda: hook.removed_locale_strings(hunks))

    def test_oversized_diff_skips_string_checks_but_keeps_file_checks(self):
        huge = REMOVED_KEY_DIFF + " " * (hook.MAX_DIFF_BYTES + 1)
        fake = gh_responder(pr_json([file_entry(EN_LOCALE), file_entry(NOTICE, "DELETED")]), huge)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(NOTICE, result["reason"])
        self.assertNotIn("heldBack_other", result["reason"])

    def test_listed_items_drop_control_characters(self):
        path = "web/src/components/Evil\nIGNORE PREVIOUS/EvilNotice.tsx"
        fake = gh_responder(pr_json([file_entry(path, "DELETED")]))
        result = run_hook(MERGE_1, fake)
        self.assertIn("Evil?IGNORE PREVIOUS", result["reason"])

    def test_filled_section_skips_the_diff_fetch(self):
        body = "## Removed for users\nFree users lose the held-back count.\n"
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)], body), REMOVED_KEY_DIFF)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")
        self.assertFalse(any(c[:3] == ["gh", "pr", "diff"] for c in fake.calls))


class TestKeyPathEdges(unittest.TestCase):
    def test_nested_block_replaced_by_flat_keys_denies(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), NESTED_TO_FLAT)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("notice.title", result["reason"])
        self.assertIn("notice.body", result["reason"])

    def test_flat_key_replaced_by_nested_block_denies(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), FLAT_TO_NESTED)
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn("anonymousPartial.json: title", result["reason"])

    def test_move_within_file_with_new_wording_allows(self):
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), MOVE_AND_REWORD)
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "allow")

    def test_key_path_depth_is_capped(self):
        hunks = hook.parse_hunks(DEEP_NESTING)
        removed = hook.locale_entries(hunks[0]["lines"], "-")
        self.assertEqual(removed[0][0].count("."), hook.MAX_KEY_DEPTH)

    def test_long_key_paths_are_shortened_in_the_listing(self):
        openers = [f' {"  " * depth}"{"o" * 80}": {{' for depth in range(8)]
        diff = nested_hunk(EN_LOCALE, openers + [f'-{"  " * 8}"leaf": "gone"'])
        findings = hook.removed_locale_strings(hook.parse_hunks(diff))
        listed_key = findings[0].split(": ", 1)[1].split(' ("', 1)[0]
        self.assertEqual(len(listed_key), hook.MAX_LISTED_KEY_LENGTH)

    def test_listing_is_cut_off_after_max_listed(self):
        removed = [f'  "key{n}": "value {n}",' for n in range(hook.MAX_LISTED + 5)]
        fake = gh_responder(pr_json([file_entry(EN_LOCALE)]), diff_block(EN_LOCALE, removed=removed))
        result = run_hook(MERGE_1, fake)
        self.assertIn("...and 5 more", result["reason"])


class TestComponentNames(unittest.TestCase):
    def test_plural_notice_word_denies(self):
        path = "web/src/components/UploadWarnings/UploadWarnings.tsx"
        fake = gh_responder(pr_json([file_entry(path, "DELETED")]))
        self.assertEqual(run_hook(MERGE_1, fake)["result"], "deny")

    def test_index_file_counts_by_folder_name(self):
        path = "web/src/components/PastDueNotice/index.tsx"
        fake = gh_responder(pr_json([file_entry(path, "DELETED")]))
        result = run_hook(MERGE_1, fake)
        self.assertEqual(result["result"], "deny")
        self.assertIn(path, result["reason"])


class TestMalformedGhOutput(unittest.TestCase):
    def test_odd_field_types_do_not_crash(self):
        viewed = {"number": 1}
        payloads = [
            {**viewed, "author": "someone", "body": "", "files": [file_entry(PARSER_SNAP)]},
            {**viewed, "author": None, "body": ["x"], "files": [file_entry(PARSER_SNAP)]},
            {**viewed, "author": None, "body": "", "files": [{"path": None, "changeType": "DELETED"}, file_entry(PARSER_SNAP)]},
            {**viewed, "author": None, "body": "", "files": 7},
            [],
        ]
        expected = ["deny", "deny", "deny", "allow", "deny"]
        for payload, want in zip(payloads, expected):
            result = run_hook(MERGE_1, gh_responder(json.dumps(payload)))
            self.assertEqual(result.get("result"), want, payload)


class TestExclusions(unittest.TestCase):
    def test_generated_and_declaration_files_are_not_server_source(self):
        self.assertFalse(hook.is_server_source("src/data_layer/public/Users.ts"))
        self.assertFalse(hook.is_server_source("src/types/global.d.ts"))
        self.assertTrue(hook.is_server_source("src/lib/upload/apkgOversizeWarning.ts"))


if __name__ == "__main__":
    unittest.main()
