#!/usr/bin/env python3
import importlib.util
import os
import unittest

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "merge_command", os.path.join(HOOKS_DIR, "merge_command.py")
)
mc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mc)


class TestRunsMerge(unittest.TestCase):
    def test_plain(self):
        self.assertTrue(mc.is_gh_pr_merge("gh pr merge 4244 --squash"))

    def test_with_url(self):
        self.assertTrue(mc.is_gh_pr_merge("gh pr merge https://github.com/2anki/server/pull/4244"))

    def test_after_and(self):
        self.assertTrue(mc.is_gh_pr_merge("git fetch && gh pr merge 4244"))

    def test_after_semicolon(self):
        self.assertTrue(mc.is_gh_pr_merge("cd /tmp; gh pr merge 4244"))

    def test_with_env_prefix(self):
        self.assertTrue(mc.is_gh_pr_merge("CLAUDE_SKIP_SAFETY=1 gh pr merge 4244"))

    def test_in_command_substitution(self):
        self.assertTrue(mc.is_gh_pr_merge("OUT=$(gh pr merge 4244 --squash)"))

    def test_on_its_own_line_in_a_script(self):
        self.assertTrue(mc.is_gh_pr_merge("set -e\ngh pr merge 4244\necho done"))

    def test_with_extra_spaces(self):
        self.assertTrue(mc.is_gh_pr_merge("gh  pr   merge 4244"))

    def test_after_then(self):
        self.assertTrue(mc.is_gh_pr_merge("if true; then gh pr merge 4244; fi"))

    def test_after_exec(self):
        self.assertTrue(mc.is_gh_pr_merge("exec gh pr merge 4244"))

    def test_in_backtick_substitution(self):
        self.assertTrue(mc.is_gh_pr_merge("x=`gh pr merge 4244`"))

    def test_double_quote_inside_single_quotes_does_not_swallow_a_later_merge(self):
        self.assertTrue(mc.is_gh_pr_merge("echo 'don\"t' && gh pr merge 4244 && echo \"x\""))

    def test_single_quote_inside_double_quotes_does_not_swallow_a_later_merge(self):
        self.assertTrue(mc.is_gh_pr_merge('echo "it\'s" && gh pr merge 4244 && echo \'y\''))


class TestMentionsOnly(unittest.TestCase):
    def test_gh_pr_view_is_not_merge(self):
        self.assertFalse(mc.is_gh_pr_merge("gh pr view 4244 --json body"))

    def test_commit_message_mention(self):
        cmd = 'git commit -m "feat: gate gh pr merge on rails" -m "why: gh pr merge was unguarded"'
        self.assertFalse(mc.is_gh_pr_merge(cmd))

    def test_single_quoted_mention(self):
        self.assertFalse(mc.is_gh_pr_merge("echo 'never run gh pr merge by hand'"))

    def test_heredoc_body_mention(self):
        cmd = "python3 - <<'EOF'\ns = 'NEVER run `gh pr merge` by hand'\nprint(s)\nEOF\ngit status"
        self.assertFalse(mc.is_gh_pr_merge(cmd))

    def test_heredoc_body_mention_unquoted_delimiter(self):
        cmd = "cat <<EOF > notes.md\n- Before gh pr merge: check rollup\nEOF"
        self.assertFalse(mc.is_gh_pr_merge(cmd))

    def test_grep_for_the_phrase(self):
        self.assertFalse(mc.is_gh_pr_merge('grep -rn "gh pr merge" .claude/'))

    def test_merge_after_heredoc_still_counts(self):
        cmd = "cat <<EOF > notes.md\nsee /ship\nEOF\ngh pr merge 4244"
        self.assertTrue(mc.is_gh_pr_merge(cmd))

    def test_merge_after_quoted_mention_still_counts(self):
        cmd = 'echo "shipping via gh pr merge" && gh pr merge 4244'
        self.assertTrue(mc.is_gh_pr_merge(cmd))


if __name__ == "__main__":
    unittest.main()
