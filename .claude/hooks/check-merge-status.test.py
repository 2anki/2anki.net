#!/usr/bin/env python3
import importlib.util
import os
import unittest

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


if __name__ == "__main__":
    unittest.main()
