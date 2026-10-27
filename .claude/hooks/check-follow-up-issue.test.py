#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location(
    "follow_up", pathlib.Path(__file__).parent / "check-follow-up-issue.py"
)
follow_up = importlib.util.module_from_spec(spec)
spec.loader.exec_module(follow_up)


class TestBlockedTitles(unittest.TestCase):
    def test_titles_moved_on_2026_10_27_are_blocked(self):
        for title in [
            "Read (by 2026-10-30): zip over the monthly limit for signed-in free users",
            'Review: home "Try a sample" adoption (by 2026-11-03)',
            "Adoption review: deck distribution fake-door (keep/remove by 2026-11-04)",
            "Search Console read (2026-11-08): do the German landing pages pick up the German click share",
            "T+30 adoption review: PDF Pages option (review 2026-11-19)",
            "Adoption review (next read 2026-12-14): AI credit packs, keep or remove",
            "Needs you: verify Google OAuth branding in Cloud Console (deadline 2026-12-21)",
            "Decide: branch protection strict=false on main now the merge queue is off",
            "Pro price on the limit wall, keep or revert",
            "chore: run the pause-offer adoption review that #3529 skipped",
        ]:
            with self.subTest(title=title):
                self.assertIsNotNone(follow_up.blocked_reason(title))

    def test_work_titles_pass(self):
        for title in [
            "fix: subscription checkouts from the limit wall rarely complete, while pass checkouts do",
            "Notion pages with no toggles end as an empty deck with no way forward",
            "feat: add a review step before export",
            "Cherry-pick silently drops most cards: explain it on the result",
            "Production deploy failed",
            "Upload: read the file before the review screen",
            "docs: T+30 review rules must name the reachable denominator",
            "fix(mcp): keep or remove the stale tool annotation",
        ]:
            with self.subTest(title=title):
                self.assertIsNone(follow_up.blocked_reason(title))


class TestTitleExtraction(unittest.TestCase):
    def test_reads_long_flag(self):
        self.assertEqual(
            follow_up.title_from('gh issue create --repo 2anki/server --title "Needs you: x" --body y'),
            "Needs you: x",
        )

    def test_reads_short_flag(self):
        self.assertEqual(follow_up.title_from("gh issue create -t 'Review: x (by 2026-11-03)'"), "Review: x (by 2026-11-03)")

    def test_reads_equals_form(self):
        self.assertEqual(follow_up.title_from('gh issue create --title="Adoption review: x"'), "Adoption review: x")

    def test_reads_gh_api_field(self):
        self.assertEqual(
            follow_up.title_from("gh api repos/2anki/server/issues -f title='Needs you: x' -f body=y"),
            "Needs you: x",
        )

    def test_reads_gh_api_long_field_flags(self):
        for command in [
            "gh api repos/2anki/server/issues --field title='Needs you: x'",
            "gh api repos/2anki/server/issues --raw-field 'title=Needs you: x'",
        ]:
            with self.subTest(command=command):
                self.assertEqual(follow_up.title_from(command), "Needs you: x")

    def test_other_commands_have_no_title(self):
        for command in [
            'gh pr create --title "Adoption review: x"',
            'gh issue edit 12 --title "Adoption review: x"',
            'git commit -m "Adoption review: x"',
            "gh issue list --search 'Needs you'",
        ]:
            with self.subTest(command=command):
                self.assertIsNone(follow_up.title_from(command))


if __name__ == "__main__":
    unittest.main()
