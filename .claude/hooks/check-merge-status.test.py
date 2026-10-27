#!/usr/bin/env python3
import importlib.util
import io
import json
import os
import time
import unittest
from unittest import mock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "check_merge_status",
    os.path.join(HOOKS_DIR, "check-merge-status.py"),
)
check_merge_status = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_merge_status)


class IsDependabotTest(unittest.TestCase):
    def test_accepts_the_login_gh_pr_view_reports(self):
        self.assertTrue(check_merge_status.is_dependabot("app/dependabot"))

    def test_accepts_the_login_the_ui_and_rest_api_report(self):
        self.assertTrue(check_merge_status.is_dependabot("dependabot[bot]"))

    def test_rejects_a_human_author_and_missing_login(self):
        self.assertFalse(check_merge_status.is_dependabot("alemayhu"))
        self.assertFalse(check_merge_status.is_dependabot(None))
        self.assertFalse(check_merge_status.is_dependabot(""))


def commits(*headlines):
    return [{"messageHeadline": h} for h in headlines]


SPEC_PR = {
    "headRefName": "feat/spec-credits",
    "commits": commits("docs: add spec for credits", "feat: ship credits"),
}


class IsSpecBranchTest(unittest.TestCase):
    def test_matches_spec_draft_branch_names(self):
        self.assertTrue(check_merge_status.is_spec_branch("feat/spec-credits"))
        self.assertTrue(check_merge_status.is_spec_branch("fix/spec-empty-deck"))

    def test_rejects_plain_feature_branches_and_blanks(self):
        self.assertFalse(check_merge_status.is_spec_branch("feat/credits"))
        self.assertFalse(check_merge_status.is_spec_branch("main"))
        self.assertFalse(check_merge_status.is_spec_branch(None))
        self.assertFalse(check_merge_status.is_spec_branch(""))


class CameFromSpecTest(unittest.TestCase):
    def test_spec_branch_plus_add_spec_commit_is_a_spec_pr(self):
        self.assertTrue(check_merge_status.came_from_spec(SPEC_PR))

    def test_spec_branch_plus_remove_commit_is_a_spec_pr(self):
        pr = {"headRefName": "fix/spec-x", "commits": commits("chore: remove implemented spec for x")}
        self.assertTrue(check_merge_status.came_from_spec(pr))

    def test_spec_named_slug_without_spec_commit_is_not(self):
        pr = {"headRefName": "chore/spec-lifecycle-gates", "commits": commits("chore: add gates")}
        self.assertFalse(check_merge_status.came_from_spec(pr))

    def test_non_spec_branch_with_spec_commit_is_not(self):
        pr = {"headRefName": "feat/credits", "commits": commits("docs: add spec for credits")}
        self.assertFalse(check_merge_status.came_from_spec(pr))


class HasDeviationsHeadingTest(unittest.TestCase):
    def test_detects_the_heading(self):
        self.assertTrue(check_merge_status.has_deviations_heading("## Deviations from spec\nNone"))
        self.assertTrue(check_merge_status.has_deviations_heading("text\n### Deviations from spec"))

    def test_absent_heading_is_false(self):
        self.assertFalse(check_merge_status.has_deviations_heading("## How\nstuff"))
        self.assertFalse(check_merge_status.has_deviations_heading(None))
        self.assertFalse(check_merge_status.has_deviations_heading(""))


class DeviationsViolationTest(unittest.TestCase):
    def test_non_spec_pr_is_unaffected(self):
        pr = {"headRefName": "feat/credits", "commits": commits("feat: x"), "body": "no heading"}
        self.assertIsNone(check_merge_status.deviations_violation(pr))

    def test_spec_named_but_not_spec_lifecycle_is_unaffected(self):
        pr = {"headRefName": "chore/spec-lifecycle-gates", "commits": commits("chore: gates"), "body": ""}
        self.assertIsNone(check_merge_status.deviations_violation(pr))

    def test_spec_pr_with_heading_passes(self):
        pr = {**SPEC_PR, "body": "## Deviations from spec\nNone — matches the spec"}
        self.assertIsNone(check_merge_status.deviations_violation(pr))

    def test_spec_pr_without_heading_violates(self):
        pr = {**SPEC_PR, "body": "## How\njust code"}
        violation = check_merge_status.deviations_violation(pr)
        self.assertIsNotNone(violation)
        self.assertIn("Deviations from spec", violation)


REACH_TABLE = (
    "## Who else this reaches\n"
    "| Population | Proof |\n"
    "| --- | --- |\n"
    "| signed-in free | `UploadPage.test.tsx` > keeps the held-back notice |\n"
)


def files(*paths):
    return [{"path": p} for p in paths]


def user_visible_pr(body, *paths, title="fix: keep the held-back notice"):
    return {
        "title": title,
        "commits": commits(title),
        "files": files(*paths),
        "body": body,
    }


class IsUserVisiblePrTest(unittest.TestCase):
    def test_feat_and_fix_titles_count(self):
        for title in ("feat: x", "fix: x", "fix(web): x", "feat!: x", "FIX: x"):
            self.assertTrue(check_merge_status.is_user_visible_pr({"title": title, "commits": []}), title)

    def test_a_feat_commit_under_a_chore_title_counts(self):
        pr = {"title": "chore: tidy", "commits": commits("chore: tidy", "feat: new gate")}
        self.assertTrue(check_merge_status.is_user_visible_pr(pr))

    def test_other_prefixes_do_not_count(self):
        for title in (
            "chore: x",
            "refactor: x",
            "test: x",
            "build(deps): x",
            "docs: fix typo",
            "revert: fix: x",
            'Revert "fix: x (#1)"',
            "",
        ):
            pr = {"title": title, "commits": commits(title)}
            self.assertFalse(check_merge_status.is_user_visible_pr(pr), title)

    def test_missing_title_and_commits_do_not_count(self):
        self.assertFalse(check_merge_status.is_user_visible_pr({}))


class IsReachSourceTest(unittest.TestCase):
    def test_server_and_web_source_count(self):
        for path in (
            "src/controllers/UploadController.ts",
            "web/src/pages/UploadPage/UploadPage.tsx",
            "web/src/locales/en/upload.json",
            "web/src/styles/base.css",
        ):
            self.assertTrue(check_merge_status.is_reach_source(path), path)

    def test_tests_fixtures_snapshots_changelog_and_docs_do_not(self):
        for path in (
            "src/lib/parser/DeckParser.test.ts",
            "web/src/pages/UploadPage/UploadPage.test.tsx",
            "src/lib/x.spec.ts",
            "src/services/NotionService/BlockHandler/__tests__/helpers.ts",
            "src/lib/parser/golden/__snapshots__/a.snap",
            "src/test/fixtures/page.html",
            "src/test/test-utils.ts",
            "web/src/test/fixtures/deck.json",
            "src/lib/parser/__fixtures__/page.html",
            "src/lib/fixtures/page.html",
            "src/services/NotionService/_mock/page.json",
            "src/infrastracture/adapters/fileConversion/___mock/a.pdf",
            "web/src/setupTests.ts",
            "web/src/pages/WhatsNewPage/changelog/2026-10-27-x.json",
            "src/lib/parser/FEATURE.md",
            "src/controllers/CLAUDE.md",
        ):
            self.assertFalse(check_merge_status.is_reach_source(path), path)

    def test_paths_outside_src_do_not(self):
        for path in (".claude/hooks/x.py", "CLAUDE.md", "migrations/1_x.js", "package.json", "srcs/x.ts"):
            self.assertFalse(check_merge_status.is_reach_source(path), path)


class ReachSectionTextTest(unittest.TestCase):
    def test_reads_text_up_to_the_next_heading(self):
        body = "## What\nx\n## Who else this reaches\n- free: test A\n## Risks\nnone"
        self.assertEqual(check_merge_status.reach_section_text(body), "- free: test A")

    def test_absent_heading_is_none(self):
        self.assertIsNone(check_merge_status.reach_section_text("## What\nx"))
        self.assertIsNone(check_merge_status.reach_section_text(None))

    def test_heading_level_and_case_are_flexible(self):
        self.assertEqual(
            check_merge_status.reach_section_text("### who else this reaches\nfree: test"),
            "free: test",
        )


class HasReachSectionTest(unittest.TestCase):
    def test_table_section_passes(self):
        self.assertTrue(check_merge_status.has_reach_section(REACH_TABLE))

    def test_windows_line_endings_are_read(self):
        self.assertTrue(check_merge_status.has_reach_section(REACH_TABLE.replace("\n", "\r\n")))

    def test_unclosed_comment_openers_stay_fast_and_fail(self):
        body = "## Who else this reaches\n" + "<!--" * 16000
        started = time.monotonic()
        self.assertFalse(check_merge_status.has_reach_section(body))
        self.assertLess(time.monotonic() - started, 0.5)

    def test_the_engineer_template_pasted_unchanged_fails(self):
        with open(os.path.join(HOOKS_DIR, "..", "agents", "engineer.md"), encoding="utf-8") as handle:
            template = handle.read().split("## PR description template", 1)[1]
        self.assertIsNotNone(check_merge_status.reach_section_text(template))
        self.assertFalse(check_merge_status.has_reach_section(template))

    def test_empty_or_placeholder_sections_fail(self):
        for body in (
            "## Who else this reaches\n\n## Risks\nx",
            "## Who else this reaches\n<!-- list populations -->\n## Risks",
            "## Who else this reaches\nTBD",
            "## Who else this reaches\n- N/A",
            "## Who else this reaches\n- TODO\n",
            "## Who else this reaches",
            "## Who else this reaches\n| Population | Proof |\n| --- | --- |\n## Risks",
            "## How\nno section",
            "",
            None,
        ):
            self.assertFalse(check_merge_status.has_reach_section(body), repr(body))


class ReachViolationTest(unittest.TestCase):
    def test_fix_touching_web_src_without_section_violates(self):
        pr = user_visible_pr("## What\nx", "web/src/pages/UploadPage/UploadPage.tsx")
        violation = check_merge_status.reach_violation(pr)
        self.assertIsNotNone(violation)
        self.assertIn("Who else this reaches", violation)

    def test_feat_touching_src_without_section_violates(self):
        pr = user_visible_pr("", "src/usecases/x.ts", title="feat: new gate")
        self.assertIsNotNone(check_merge_status.reach_violation(pr))

    def test_fix_with_section_passes(self):
        pr = user_visible_pr(REACH_TABLE, "src/usecases/x.ts")
        self.assertIsNone(check_merge_status.reach_violation(pr))

    def test_chore_touching_src_is_unaffected(self):
        pr = user_visible_pr("", "src/usecases/x.ts", title="chore: rename")
        self.assertIsNone(check_merge_status.reach_violation(pr))

    def test_fix_touching_only_tests_and_changelog_is_unaffected(self):
        pr = user_visible_pr(
            "",
            "src/usecases/x.test.ts",
            "web/src/pages/WhatsNewPage/changelog/2026-10-27-x.json",
        )
        self.assertIsNone(check_merge_status.reach_violation(pr))

    def test_fix_touching_only_the_harness_is_unaffected(self):
        pr = user_visible_pr("", ".claude/hooks/check-merge-status.py", "CLAUDE.md")
        self.assertIsNone(check_merge_status.reach_violation(pr))

    def test_revert_of_a_fix_is_unaffected(self):
        pr = user_visible_pr("", "src/usecases/x.ts", title="revert: fix: keep the notice")
        self.assertIsNone(check_merge_status.reach_violation(pr))


class MainWiringTest(unittest.TestCase):
    def run_main(self, pr_data):
        captured = {}

        def fake_run_gh(args, label):
            captured["args"] = args
            return json.dumps(pr_data)

        stdin = io.StringIO(json.dumps({"tool_name": "Bash", "tool_input": {"command": "gh pr merge 1 --squash"}}))
        stdout = io.StringIO()
        with mock.patch.object(check_merge_status, "run_gh", fake_run_gh), \
                mock.patch.dict(os.environ, {}, clear=False), \
                mock.patch("sys.stdin", stdin), \
                mock.patch("sys.stdout", stdout):
            os.environ.pop("CLAUDE_SKIP_SAFETY", None)
            with self.assertRaises(SystemExit):
                check_merge_status.main()
        return captured["args"], json.loads(stdout.getvalue())

    def pr(self, body):
        sha = "a" * 40
        return {
            **user_visible_pr(body, "src/usecases/x.ts"),
            "headRefOid": sha,
            "headRefName": "fix/x",
            "author": {"login": "alemayhu"},
            "statusCheckRollup": [],
            "reviews": [],
            "comments": [{"body": f"<!-- ship-review: pass sha={sha} -->"}],
        }

    def test_requests_the_title_from_gh(self):
        args, _ = self.run_main(self.pr(REACH_TABLE))
        self.assertIn("title", args[args.index("--json") + 1].split(","))

    def test_denies_a_fix_merge_without_the_section(self):
        _, output = self.run_main(self.pr("## What\nx"))
        decision = output["hookSpecificOutput"]
        self.assertEqual(decision["permissionDecision"], "deny")
        self.assertIn("Who else this reaches", decision["permissionDecisionReason"])

    def test_allows_a_fix_merge_with_the_section(self):
        _, output = self.run_main(self.pr(REACH_TABLE))
        self.assertEqual(output, {"continue": True})


if __name__ == "__main__":
    unittest.main()
