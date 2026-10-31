#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import unittest
from unittest.mock import patch, MagicMock

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


class TestApiMerge(unittest.TestCase):
    def test_gh_api_put_merge(self):
        self.assertTrue(mc.is_gh_pr_merge("gh api -X PUT repos/2anki/server/pulls/4244/merge -f merge_method=squash"))

    def test_gh_api_method_flag(self):
        self.assertTrue(mc.is_gh_pr_merge("gh api --method PUT /repos/2anki/server/pulls/4244/merge"))

    def test_curl_to_merge_endpoint(self):
        self.assertTrue(mc.is_gh_pr_merge('curl -X PUT "https://api.github.com/repos/2anki/server/pulls/4244/merge"'))

    def test_api_merge_inside_quotes_still_counts(self):
        self.assertTrue(mc.is_gh_pr_merge('gh api -X PUT "repos/2anki/server/pulls/4244/merge"'))

    def test_gh_api_pull_view_is_not_merge(self):
        self.assertFalse(mc.is_gh_pr_merge("gh api repos/2anki/server/pulls/4244"))

    def test_is_merged_probe_get_is_not_merge(self):
        self.assertFalse(mc.is_gh_pr_merge("gh api repos/2anki/server/pulls/4244/merge"))
        self.assertFalse(mc.is_gh_pr_merge("gh api -X GET repos/2anki/server/pulls/4244/merge"))

    def test_curl_request_put(self):
        self.assertTrue(mc.is_gh_pr_merge("curl --request PUT https://api.github.com/repos/2anki/server/pulls/4244/merge"))

    def test_input_body_counts_as_write(self):
        self.assertTrue(mc.is_gh_pr_merge("gh api repos/2anki/server/pulls/4244/merge --input body.json"))

    def test_api_path_inside_heredoc_is_not_merge(self):
        cmd = "python3 - <<'EOF'\nassert is_merge('gh api -X PUT repos/o/r/pulls/4244/merge')\nEOF"
        self.assertFalse(mc.is_gh_pr_merge(cmd))

    def test_graphql_merge_mutation(self):
        cmd = "gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:\"PR_x\"}) { clientMutationId } }'"
        self.assertTrue(mc.is_gh_pr_merge(cmd))
        self.assertTrue(mc.is_graphql_merge(cmd))
        self.assertIsNone(mc.extract_pr_ref(cmd))

    def test_graphql_mention_inside_heredoc_is_not_merge(self):
        cmd = "cat <<'EOF' > notes.md\nthe mergePullRequest mutation is denied\nEOF"
        self.assertFalse(mc.is_gh_pr_merge(cmd))


class TestExtractPrRef(unittest.TestCase):
    def test_number(self):
        self.assertEqual(mc.extract_pr_ref("gh pr merge 4244 --squash"), "4244")

    def test_url(self):
        self.assertEqual(mc.extract_pr_ref("gh pr merge https://github.com/2anki/server/pull/4244"), "4244")

    def test_current_branch(self):
        self.assertIsNone(mc.extract_pr_ref("gh pr merge --squash --delete-branch"))

    def test_api_endpoint(self):
        self.assertEqual(mc.extract_pr_ref("gh api -X PUT repos/2anki/server/pulls/4244/merge"), "4244")

    def test_quoted_mention_before_real_merge(self):
        self.assertEqual(mc.extract_pr_ref('echo "gh pr merge" && gh pr merge 4244'), "4244")


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


def rest_line(path, status="modified", additions=1, deletions=1):
    return json.dumps([path, status, additions, deletions])


def rest_stdout(paths, status="modified"):
    return "".join(rest_line(p, status) + "\n" for p in paths)


def ok(stdout):
    return MagicMock(returncode=0, stdout=stdout, stderr="")


MANY_PATHS = [f"docs/page{i}.md" for i in range(150)] + ["web/src/App.tsx"]


class TestChangedFiles(unittest.TestCase):
    def changed(self, pr_data, pr_ref="42", run=None):
        with patch("subprocess.run", side_effect=run) as fake:
            result = mc.changed_files(pr_data, pr_ref, "[test]")
        return result, [call.args[0] for call in fake.call_args_list]

    def test_lists_files_past_the_first_100_from_the_rest_endpoint(self):
        view = {"number": 42, "files": [{"path": p} for p in MANY_PATHS[:100]]}
        (files, complete), _ = self.changed(view, run=[ok(rest_stdout(MANY_PATHS))])
        self.assertTrue(complete)
        self.assertEqual(len(files), 151)
        self.assertGreater([f["path"] for f in files].index("web/src/App.tsx"), 100)

    def test_calls_the_paginated_rest_endpoint_for_the_pr_number(self):
        _, argv = self.changed({"number": 42, "files": []}, run=[ok("")])
        self.assertEqual(argv[0][:4], ["gh", "api", "--paginate", "repos/2anki/2anki.net/pulls/42/files?per_page=100"])

    def test_a_current_branch_merge_uses_the_number_gh_pr_view_returned(self):
        _, argv = self.changed({"number": 5172, "files": []}, pr_ref=None, run=[ok("")])
        self.assertIn("repos/2anki/2anki.net/pulls/5172/files?per_page=100", argv[0])

    def test_maps_rest_statuses_to_gh_pr_view_change_types(self):
        stdout = "".join(
            rest_line(path, status, 2, 3) + "\n"
            for path, status in (("a", "added"), ("b", "removed"), ("c", "modified"), ("d", "renamed"))
        )
        (files, _), _ = self.changed({"number": 42, "files": []}, run=[ok(stdout)])
        self.assertEqual(
            [(f["path"], f["changeType"], f["additions"], f["deletions"]) for f in files],
            [("a", "ADDED", 2, 3), ("b", "DELETED", 2, 3), ("c", "MODIFIED", 2, 3), ("d", "RENAMED", 2, 3)],
        )

    def test_keeps_a_view_file_the_rest_list_lacks(self):
        view = {"number": 42, "files": [{"path": "src/a.ts", "changeType": "MODIFIED"}]}
        (files, complete), _ = self.changed(view, run=[ok(rest_stdout(["src/b.ts"]))])
        self.assertTrue(complete)
        self.assertEqual(sorted(f["path"] for f in files), ["src/a.ts", "src/b.ts"])

    def test_a_rest_failure_falls_back_to_the_view_files(self):
        view = {"number": 42, "files": [{"path": "src/a.ts"}]}
        failed = MagicMock(returncode=1, stdout="", stderr="HTTP 502")
        (files, complete), _ = self.changed(view, run=[failed])
        self.assertFalse(complete)
        self.assertEqual(files, [{"path": "src/a.ts"}])

    def test_an_os_error_or_timeout_falls_back_to_the_view_files(self):
        view = {"number": 42, "files": [{"path": "src/a.ts"}]}
        for error in (PermissionError("gh"), FileNotFoundError("gh"), subprocess.TimeoutExpired("gh", 20)):
            (files, complete), _ = self.changed(view, run=error)
            self.assertFalse(complete)
            self.assertEqual(files, [{"path": "src/a.ts"}])

    def test_unparseable_rest_output_falls_back_to_the_view_files(self):
        view = {"number": 42, "files": [{"path": "src/a.ts"}]}
        for stdout in ("not json\n", '{"path": "x"}\n', '["x", "modified"]\n', "[1, \"modified\", 1, 1]\n"):
            (files, complete), _ = self.changed(view, run=[ok(stdout)])
            self.assertFalse(complete)
            self.assertEqual(files, [{"path": "src/a.ts"}])

    def test_no_usable_pr_number_skips_the_call_and_falls_back(self):
        for number in (None, "", "12/../13", True):
            (files, complete), argv = self.changed({"number": number, "files": [{"path": "a"}]}, pr_ref=None, run=[])
            self.assertFalse(complete)
            self.assertEqual(argv, [])
            self.assertEqual(files, [{"path": "a"}])

    def test_falls_back_to_the_merge_command_number_when_view_has_none(self):
        _, argv = self.changed({"files": []}, pr_ref="77", run=[ok("")])
        self.assertIn("repos/2anki/2anki.net/pulls/77/files?per_page=100", argv[0])

    def test_lists_files_from_the_repo_gh_pr_view_resolved(self):
        view = {"number": 5, "url": "https://github.com/someone/fork/pull/5", "files": []}
        _, argv = self.changed(view, run=[ok("")])
        self.assertIn("repos/someone/fork/pulls/5/files?per_page=100", argv[0])

    def test_an_unreadable_url_falls_back_to_the_canonical_repo(self):
        for url in (None, "", "https://example.com/a/b/pull/5", "https://github.com/a/../pull/5", 7):
            _, argv = self.changed({"number": 5, "url": url, "files": []}, run=[ok("")])
            self.assertIn("repos/2anki/2anki.net/pulls/5/files?per_page=100", argv[0])

    def test_a_url_for_another_pr_number_falls_back_to_the_canonical_repo(self):
        view = {"number": 5, "url": "https://github.com/someone/fork/pull/6", "files": []}
        _, argv = self.changed(view, run=[ok("")])
        self.assertIn("repos/2anki/2anki.net/pulls/5/files?per_page=100", argv[0])

    def test_a_unicode_line_separator_in_a_name_does_not_force_the_fallback(self):
        odd = "web/src/a b\u0085c d.tsx"
        stdout = json.dumps([odd, "modified", 1, 1], ensure_ascii=False) + "\n" + rest_line("src/x.ts") + "\n"
        (files, complete), _ = self.changed({"number": 42, "files": []}, run=[ok(stdout)])
        self.assertTrue(complete)
        self.assertEqual([f["path"] for f in files], [odd, "src/x.ts"])

    def test_odd_view_shapes_do_not_raise(self):
        (files, complete), _ = self.changed({"number": 42, "files": [None, "x", {"path": "a"}]}, run=[ok("")])
        self.assertTrue(complete)
        self.assertEqual(files, [{"path": "a"}])


if __name__ == "__main__":
    unittest.main()
