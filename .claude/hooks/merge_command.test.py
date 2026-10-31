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
        self.assertIsNone(mc.allowed_merge(cmd))

    def test_graphql_mention_inside_heredoc_is_not_merge(self):
        cmd = "cat <<'EOF' > notes.md\nthe mergePullRequest mutation is denied\nEOF"
        self.assertFalse(mc.is_gh_pr_merge(cmd))


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
    def changed(self, pr_data, number="42", run=None):
        with patch("subprocess.run", side_effect=run) as fake:
            result = mc.changed_files(pr_data, number, "[test]")
        return result, [call.args[0] for call in fake.call_args_list]

    def test_lists_files_past_the_first_100_from_the_rest_endpoint(self):
        view = {"number": 42, "files": [{"path": p} for p in MANY_PATHS[:100]]}
        (files, complete), _ = self.changed(view, run=[ok(rest_stdout(MANY_PATHS))])
        self.assertTrue(complete)
        self.assertEqual(len(files), 151)
        self.assertGreater([f["path"] for f in files].index("web/src/App.tsx"), 100)

    def test_calls_the_paginated_rest_endpoint_of_2anki_net_for_the_merged_number(self):
        _, argv = self.changed({"number": 42, "url": "https://github.com/someone/fork/pull/42", "files": []}, run=[ok("")])
        self.assertEqual(argv[0][:4], ["gh", "api", "--paginate", "repos/2anki/2anki.net/pulls/42/files?per_page=100"])

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

    def test_keeps_a_view_file_the_rest_list_lacks_and_reports_the_list_incomplete(self):
        view = {"number": 42, "files": [{"path": "src/a.ts", "changeType": "MODIFIED"}]}
        (files, complete), _ = self.changed(view, run=[ok(rest_stdout(["src/b.ts"]))])
        self.assertFalse(complete)
        self.assertEqual(sorted(f["path"] for f in files), ["src/a.ts", "src/b.ts"])

    def test_a_rest_list_covering_every_view_file_is_complete(self):
        view = {"number": 42, "files": [{"path": "src/a.ts"}]}
        (_, complete), _ = self.changed(view, run=[ok(rest_stdout(["src/a.ts", "src/b.ts"]))])
        self.assertTrue(complete)

    def test_a_rest_list_at_githubs_3000_file_cap_is_reported_incomplete(self):
        paths = [f"src/file{i}.ts" for i in range(mc.REST_FILES_CAP)]
        view = {"number": 42, "files": [{"path": p} for p in paths[:100]]}
        (files, complete), _ = self.changed(view, run=[ok(rest_stdout(paths))])
        self.assertFalse(complete)
        self.assertEqual(len(files), mc.REST_FILES_CAP)

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

    def test_no_usable_number_skips_the_call_and_falls_back(self):
        for number in (None, "", "12/../13", True, 42):
            (files, complete), argv = self.changed({"files": [{"path": "a"}]}, number=number, run=[])
            self.assertFalse(complete)
            self.assertEqual(argv, [])
            self.assertEqual(files, [{"path": "a"}])

    def test_a_unicode_line_separator_in_a_name_does_not_force_the_fallback(self):
        odd = "web/src/a b\u0085c d.tsx"
        stdout = json.dumps([odd, "modified", 1, 1], ensure_ascii=False) + "\n" + rest_line("src/x.ts") + "\n"
        (files, complete), _ = self.changed({"number": 42, "files": []}, run=[ok(stdout)])
        self.assertTrue(complete)
        self.assertEqual([f["path"] for f in files], [odd, "src/x.ts"])

    def test_odd_view_shapes_do_not_raise(self):
        (files, complete), _ = self.changed({"number": 42, "files": [None, "x", {"path": "a"}, {"path": ["b"]}]}, run=[ok(rest_stdout(["a"]))])
        self.assertFalse(complete)
        self.assertEqual([f["path"] for f in files], ["a", ["b"]])


GHE = "ghe.example.com"
REJECTED_FORMS = (
    "gh pr merge 42",
    "gh pr merge 42 --squash",
    "gh pr merge --squash",
    "gh pr merge --squash --delete-branch",
    "gh pr merge some-branch --repo 2anki/server --squash",
    "gh pr merge fix/other --repo 2anki/server --squash",
    "gh pr merge #42 --repo 2anki/server --squash",
    "gh pr merge '#42' --repo 2anki/server --squash",
    'gh pr merge "42" --repo 2anki/server --squash',
    "gh pr merge '42' --repo 2anki/server --squash",
    "gh pr merge 042 --repo 2anki/server --squash",
    "gh pr merge 42 -sR other/repo",
    "gh pr merge 42 -sR 2anki/server",
    "gh pr merge 42 -R 2anki/server --squash",
    "gh pr merge 42 --repo=2anki/server --squash",
    "gh pr merge 42 --repo 2anki/server;x --squash",
    "gh pr merge 42 --squash --repo 2anki/server; true",
    "gh pr merge 42 --repo 2anki/server --squash; true",
    "gh pr merge 42 --repo 2anki/server) --squash",
    "gh pr merge 42 --repo '2anki/server' --squash",
    "gh pr merge 42 --repo $(echo 2anki/server) --squash",
    "gh pr merge 42 --repo 2anki/server --squash --admin",
    "gh pr merge 42 --repo 2anki/server --squash --delete-branch",
    "gh pr merge 42  --repo 2anki/server --squash",
    "gh pr merge 42\t--repo 2anki/server --squash",
    "gh pr merge 42 --repo 2anki/server --squash\ngh pr merge 43 --repo other/repo --squash",
    "gh pr merge 42 --repo 2anki/server --squash && gh pr merge 43 --repo other/repo --squash",
    "gh pr merge 42 --repo 2Anki/Server --squash",
    "gh pr merge 42 --repo other/repo --squash",
    f"gh pr merge 42 --repo {GHE}/2anki/server --squash",
    "gh pr merge 42 --repo github.com/2anki/server --squash",
    "gh pr merge https://github.com/2anki/server/pull/42 --repo 2anki/server --squash",
    "GH_REPO=other/repo gh pr merge 42 --repo 2anki/server --squash",
    f"GH_HOST={GHE} gh pr merge 42 --repo 2anki/server --squash",
    "cd /tmp/other && gh pr merge 42 --repo 2anki/server --squash",
    "gh -R other/repo pr merge 42 --repo 2anki/server --squash",
    "gh pr -R other/repo merge 42",
    "gh pr --repo other/repo merge 42 --squash",
    "gh pr -R 2anki/server merge 42 --repo 2anki/server --squash",
    'gh pr "merge" 42 --repo 2anki/server --squash',
    "gh pr m\\erge 42 --repo 2anki/server --squash",
    "gh pr $'merge' 42",
    "gh pr $(echo merge) 42",
    "gh pr `echo merge` 42",
    "/opt/homebrew/bin/gh pr merge 42 --repo 2anki/server --squash",
    "gh --repo 2anki/server pr merge 42",
    "gh pr merge 42 --repo 2anki/server --squash # trailing comment",
    "gh pr merge 42 --repo 2anki/server --squash 'unbalanced",
    "gh api -X PUT repos/2anki/2anki.net/pulls/42/merge",
    "curl -X PUT https://api.github.com/repos/2anki/2anki.net/pulls/42/merge",
    "gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:\"PR_x\"}) { clientMutationId } }'",
)


class TestAllowedMerge(unittest.TestCase):
    def test_accepts_exactly_the_ship_command_and_its_canonical_name_variant(self):
        self.assertEqual(mc.allowed_merge("gh pr merge 42 --repo 2anki/server --squash"), ("42", "2anki/server"))
        self.assertEqual(mc.allowed_merge("gh pr merge 5193 --repo 2anki/2anki.net --squash"), ("5193", "2anki/2anki.net"))
        self.assertEqual(mc.allowed_merge("gh pr merge 42 --repo 2anki/server --squash\n"), ("42", "2anki/server"))
        self.assertIsNone(mc.merge_form_violation("gh pr merge 42 --repo 2anki/server --squash"))

    def test_every_other_form_is_refused(self):
        for cmd in REJECTED_FORMS:
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)
            self.assertIsNone(mc.allowed_merge(cmd), cmd)
            self.assertIn("gh pr merge <n> --repo 2anki/server --squash", mc.merge_form_violation(cmd), cmd)

    def test_gh_commands_that_only_read_merge_fields_are_not_merges(self):
        for cmd in (
            "gh pr view 5 --json mergeStateStatus,mergeable",
            "gh pr list --json mergedAt --state merged",
            "gh pr view 5 --json number && git merge --ff-only origin/main",
            'gh pr view "$PR" --json title',
            'git commit -m "fix: gh pr merge reads every file" -m "why: the gate missed files"',
            "gh pr checkout 5 && git merge origin/main",
        ):
            self.assertFalse(mc.is_gh_pr_merge(cmd), cmd)

    def test_non_strings_are_refused(self):
        for cmd in (None, 42, ["gh", "pr", "merge"]):
            self.assertIsNone(mc.allowed_merge(cmd))

    def test_a_failed_view_message_names_the_pr(self):
        self.assertIn("PR 42", mc.view_failed_violation("42"))


class TestViewRepo(unittest.TestCase):
    def test_a_canonical_url_for_the_merged_number_passes(self):
        for url in ("https://github.com/2anki/2anki.net/pull/5", "https://github.com/2anki/server/pull/5"):
            self.assertIsNone(mc.view_repo_violation({"number": 5, "url": url}, "5"), url)

    def test_a_url_in_another_repo_is_refused(self):
        view = {"number": 5, "url": "https://github.com/someone/fork/pull/5"}
        self.assertIn("someone/fork", mc.view_repo_violation(view, "5"))

    def test_a_url_for_another_pr_is_refused(self):
        view = {"number": 6, "url": "https://github.com/2anki/2anki.net/pull/6"}
        self.assertIn("not PR 5", mc.view_repo_violation(view, "5"))

    def test_a_number_that_disagrees_with_the_url_is_refused(self):
        for number in (7, None, "x", True):
            view = {"number": number, "url": "https://github.com/2anki/2anki.net/pull/6"}
            self.assertIsNotNone(mc.view_repo_violation(view, "6"), number)

    def test_a_missing_or_odd_url_is_refused(self):
        for url in (
            None,
            "",
            7,
            f"https://{GHE}/2anki/server/pull/5",
            "https://github.com/2anki/server/pull/5/files",
            "https://github.com/2anki/server/pull/5\n",
        ):
            self.assertIsNotNone(mc.view_repo_violation({"number": 5, "url": url}, "5"), url)


if __name__ == "__main__":
    unittest.main()
