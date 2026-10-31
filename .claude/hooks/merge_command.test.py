#!/usr/bin/env python3
import importlib.util
import json
import os
import re
import subprocess
import unittest
from unittest.mock import patch, MagicMock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "merge_command", os.path.join(HOOKS_DIR, "merge_command.py")
)
mc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mc)


class TestDetection(unittest.TestCase):
    def test_any_command_naming_gh_and_merge_is_a_merge_attempt(self):
        for cmd in (
            "gh pr merge 4244 --squash",
            "GH PR MERGE 1",
            "gh pr view 5 --json mergeStateStatus",
            'git commit -m "fix: gate gh pr merge on rails"',
            "cat <<EOF > notes.md\ngh pr merge 1\nEOF",
            "eval gh pr merge 1",
            "bash -lc 'gh pr merge 1'",
            "gh pr merge 1 > /tmp/out 2>&1",
            "gh api -X PUT repos/2anki/server/pulls/1/merge",
            "gh api graphql -f query='mutation { mergePullRequest(input:{}) { clientMutationId } }'",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_quotes_and_backslashes_cannot_split_the_words(self):
        for cmd in ('"g"h pr merge 1', "gh pr \"mer\"ge 1", "gh pr m\\erge 1", "g\\\nh pr me\\\nrge 1", "'g'h pr 'mer'ge 1"):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_words_built_at_run_time_are_merge_attempts(self):
        for cmd in (
            "$'g\\x68' pr merge 1",
            "g$''h pr merge 1",
            'g$""h pr merge 1',
            "$(echo gh) pr merge 1",
            "`echo gh` pr merge 1",
            "gh pr $'\\x6derge' 1",
            "G=g; ${G}h pr merge 1",
            "$'\\x67\\x68' pr $'\\x6d\\x65\\x72\\x67\\x65' 1",
            "gh pr me$x 1",
            "gh pr `echo merge` 1",
            "gh pr $(printf me; printf rge) 1",
            "curl -X PUT https://api.github.com/repos/2anki/2anki.net/pulls/1/${WORD}",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)
            self.assertIsNotNone(mc.merge_form_violation(cmd), cmd)

    def test_api_merges_main_gated_without_gh_in_the_command_are_merge_attempts(self):
        for cmd in (
            "curl -sk -X PUT -H @/tmp/h https://140.82.121.6/repos/2anki/2anki.net/pulls/5184/merge",
            "wget --method=PUT https://140.82.121.6/repos/2anki/2anki.net/pulls/5184/merge",
            "curl -X POST -H @/tmp/h https://140.82.121.6/graphql -d @/tmp/mergePullRequest.json",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_commands_without_both_words_are_not_merge_attempts(self):
        for cmd in (
            "git status",
            "gh pr view 5193 --repo 2anki/server --json number,headRefOid,statusCheckRollup",
            "git log origin/main --format=%H -1 --grep='(#5193)'",
            "git fetch origin main && git rebase origin/main",
            "gh pr ready 5193",
            None,
            42,
        ):
            self.assertFalse(mc.is_gh_pr_merge(cmd), cmd)


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
    'gh pr -b x "merge" 42 --repo 2anki/server --squash',
    "gh pr --subject x m\\erge 42",
    'gh -b x pr "merge" 42',
    "gh pr --json number merge 42",
    "gh $'pr' merge 42",
    'gh $"pr" merge 42',
    "gh $(echo pr) merge 42",
    "gh ${P:-pr} merge 42",
    "gh p\\\nr merge 42",
    "gh pr mer\\\nge 42",
    "g\\\nh pr merge 42",
    "GH pr merge 42 --repo 2anki/server --squash",
    "/usr/local/bin/GH pr merge 42",
    "G=gh; $G pr merge 42",
    "$(which gh) pr merge 42",
    'eval "gh pr merge 42"',
    "bash -c 'gh pr merge 42'",
    "/bin/sh -c \"gh pr merge 42\"",
    "printf merge | xargs gh pr",
    "gh alias set pm 'pr merge'",
    'gh api -X PUT repos/2anki/server/pulls/"42"/merge',
    'gh api -X PUT repos/2anki/server/pulls/42/merg"e"',
    "gh api -X PUT repos/2anki/server/pulls/$N/merge",
    'gh api -X P"UT" repos/2anki/server/pulls/42/merge',
    "gh api graphql -F query=@merge.graphql",
    "bash -lc 'gh pr merge 42 --repo 2anki/server --squash'",
    "eval gh pr merge 42 --repo 2anki/server --squash",
    "eval 'gh pr' 'merge 42'",
    "gh pr merge 42 --repo 2anki/server --squash > /tmp/out",
    "gh pr merge 42 --repo 2anki/server --squash >&2",
    "gh pr merge 42 --repo 2anki/server --squash 2>&1 | tee /tmp/log",
    "gh pr merge 42 --repo 2anki/server --squash 2>/dev/null",
    "gh pr merge 42 --repo 2anki/server --squash 2>&1 2>&1",
    "2>&1 gh pr merge 42 --repo 2anki/server --squash",
    "gh pr merge 42 --repo 2anki/server --squash --delete-branch --auto",
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

    def test_the_deny_names_the_rule_that_fired_and_its_fix(self):
        for cmd, reason, fix in (
            ('git commit -m "docs: gh pr merge"', "contains `gh` (or `github`) and `merge`", "git commit -F"),
            ("IFS=$'\\n' read -r x", "ANSI-C quote", "without `$'`"),
            ('gh pr edit 5 --body "see `x`"', "with a `$` or a backtick", "--body-file"),
            ("curl https://example.com/merge", "next to `pulls/`", "URL or an API path"),
        ):
            message = mc.merge_form_violation(cmd)
            self.assertIn(reason, message, cmd)
            self.assertIn(fix, message, cmd)

    def test_every_ship_command_but_the_step_4_one_is_left_alone(self):
        ship = open(os.path.join(HOOKS_DIR, "..", "commands", "ship.md")).read()
        blocks = re.findall(r"```bash\n(.*?)```", ship, re.S)
        scratchpad = "/private/tmp/claude-501/-Users-a-src-github-com-2anki-server/session/scratchpad"
        lines = [
            line.strip().replace("<scratchpad>", scratchpad)
            for block in blocks
            for line in block.splitlines()
            if line.strip()
        ]
        self.assertGreater(len(lines), 8)
        for line in lines:
            if line.startswith("gh pr merge "):
                self.assertEqual(mc.allowed_merge(line.replace("<n>", "42")), ("42", "2anki/server"), line)
            else:
                self.assertFalse(mc.is_gh_pr_merge(line), line)

    def test_a_trailing_2_to_1_redirect_is_the_only_suffix_allowed(self):
        self.assertEqual(mc.allowed_merge("gh pr merge 42 --repo 2anki/server --squash 2>&1"), ("42", "2anki/server"))

    def test_non_strings_are_refused(self):
        for cmd in (None, 42, ["gh", "pr", "merge"]):
            self.assertIsNone(mc.allowed_merge(cmd))

    def test_an_error_inside_the_gate_denies(self):
        denied = []

        def broken_gate(cmd):
            raise AttributeError("str has no get")

        mc.deny_on_error(broken_gate, "gh pr merge 1 --repo 2anki/server --squash", denied.append)
        self.assertEqual(len(denied), 1)
        self.assertIn("AttributeError", denied[0])

    def test_a_gate_that_exits_is_left_alone(self):
        def exiting_gate(cmd):
            raise SystemExit(0)

        with self.assertRaises(SystemExit):
            mc.deny_on_error(exiting_gate, "gh pr merge 1 --repo 2anki/server --squash", lambda reason: None)

    def test_a_failed_view_message_names_the_pr(self):
        self.assertIn("PR 42", mc.view_failed_violation("42"))


class TestViewRepo(unittest.TestCase):
    def test_a_canonical_url_for_the_merged_number_passes(self):
        self.assertIsNone(mc.view_repo_violation({"number": 5, "url": "https://github.com/2anki/2anki.net/pull/5"}, "5"))

    def test_a_url_under_the_old_name_is_refused(self):
        self.assertIsNotNone(mc.view_repo_violation({"number": 5, "url": "https://github.com/2anki/server/pull/5"}, "5"))

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
