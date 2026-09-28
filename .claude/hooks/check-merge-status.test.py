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


if __name__ == "__main__":
    unittest.main()
