#!/usr/bin/env python3
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "merge_command", os.path.join(HOOKS_DIR, "merge_command.py")
)
mc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mc)


ORDINARY_COMMANDS = (
    "gh pr list --repo 2anki/server --state merged --limit 5",
    "gh pr create --repo 2anki/server --base main --head x --body-file f.md",
    "cd /Users/a/src/github.com/2anki/server && git log -1 --format=%H",
    'git commit -m "fix: describe the merge gate"',
    "gh pr view 1 --json mergeable,mergeStateStatus",
    "gh run list --workflow deploy.2anki.net.yml --json headSha --jq '.[0].headSha'",
)


class TestDetection(unittest.TestCase):
    def test_gh_and_the_word_merge_anywhere_is_a_merge_attempt(self):
        for cmd in (
            "gh pr merge 4244 --squash",
            "GH PR MERGE 1",
            "/opt/homebrew/bin/gh pr merge 1",
            "cat <<EOF > notes.md\ngh pr merge 1\nEOF",
            "git status; gh pr merge 1",
            "echo 1 | gh pr merge",
            "{ gh pr merge 1; }",
            "eval gh pr merge 1",
            "sudo -u root gh pr merge 1",
            "env GH_TOKEN=x gh pr merge 1",
            "printf merge | xargs gh pr",
            "bash -lc 'gh pr merge 1'",
            "2>&1 gh pr merge 1",
            "gh alias set pm 'pr merge'",
            "gh api -X PUT repos/2anki/server/pulls/1/merge",
            "gh api graphql -F query=@merge.graphql",
            "gh api graphql -f query='mutation { mergePullRequest(input:{}) { clientMutationId } }'",
            "echo gh pr merge 1",
            'git commit -m "fix: gate gh pr merge on rails"',
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_wrappers_no_list_could_keep_complete_are_merge_attempts(self):
        for cmd in (
            "trap 'gh pr merge 1' EXIT",
            "function f { gh pr merge 1; }; f",
            "coproc gh pr merge 1",
            "su -c 'gh pr merge 1'",
            "runuser -u a -- gh pr merge 1",
            "git -c alias.x='!gh pr merge 1' x",
            "git rebase --exec 'gh pr merge 1' HEAD~1",
            "osascript -e 'do shell script \"gh pr merge 1\"'",
            "tmux new -d 'gh pr merge 1'",
            "python -c \"import os; os.system('gh pr merge 1')\"",
            "node -e \"require('child_process').execSync('gh pr merge 1')\"",
            "echo gh pr merge 1 | bash",
            "source <(echo gh pr merge 1)",
            "arch -arm64 gh pr merge 1",
            "npm exec -- gh pr merge 1",
            "op run -- gh pr merge 1",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_quotes_and_backslashes_cannot_split_the_words(self):
        for cmd in ('"g"h pr merge 1', "gh pr \"mer\"ge 1", "gh pr m\\erge 1", "g\\\nh pr me\\\nrge 1", "'g'h pr 'mer'ge 1", "\\gh pr merge 1"):
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
            "$'\\x67\\x68' $'\\x70\\x72' $'\\x6d\\x65\\x72\\x67\\x65' 1",
            "eval $'\\x67\\x68 pr \\x6d\\x65\\x72\\x67\\x65 1'",
            "bash -c $'\\x67\\x68 pr \\x6d\\x65\\x72\\x67\\x65 1'",
            "sudo $'\\x67\\x68' pr merge 1",
            "eval $'\\147\\150 pr \\155erge 1'",
            "eval $'\\x6\\\n7\\x68 pr \\x6d\\x65\\x72\\x67\\x65 1'",
            "eval $\\\n'\\x67\\x68 pr \\x6d\\x65\\x72\\x67\\x65 1'",
            "printf '\\x67\\x68 pr \\x6d\\x65rge 1' | sh",
            "printf '\\x67\\x68 pr merge 1' | sh",
            "echo -e '\\x67h pr \\x6derge 1' | sh",
            "echo -ne '\\147\\150 pr \\155erge 1' | bash",
            "echo -ne '\\x67h pr \\155erge 1' | sh",
            "echo '\\147h pr \\155erge 1' > f",
            "printf '\\7\\147h pr \\155erge 1' > f",
            "cat f | s\"h\" -s '\\x67h pr \\x6derge 1'",
            "e\"va\"l '\\x67h pr \\x6derge 1'",
            "eval \"\\u0067h pr \\u006derge 1\"",
            "gh pr me$x 1",
            "gh pr me${x}rge 1",
            "gh pr -R 2anki/server me$x 1",
            "gh pr -a 1 -b 2 -c 3 -d 4 -e 5 -f 6 -g 7 -h 8 -i 9 me$x 1",
            "gh -a 1 -b 2 -c 3 -d 4 -e 5 -f 6 -g 7 -h 8 -i 9 -j 10 $P $V 1",
            "gh pr " + "-a 1 " * 5000 + "me`printf x`rge 1",
            "gh${IFS}pr${IFS}me${x}rge${IFS}1",
            "gh $P $V 1",
            "gh pr `echo merge` 1",
            "gh pr `printf me; printf rge` 1",
            "gh pr $(printf me; printf rge) 1",
            "$(echo gh) pr me$x 1",
            "gh api repos/2anki/server/pulls/1/$WORD",
            "$(echo g)h api -X PUT repos/a/b/pulls/1/m$x",
            "`echo g`h api repos/a/b/issues/1",
            "gh alias set pm \"pr $V\"",
            "curl -X PUT https://api.github.com/repos/2anki/2anki.net/pulls/1/${WORD}",
            "curl -X PUT https://140.82.121.6/repos/2anki/2anki.net/pulls/1/${WORD}",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)
            self.assertIsNotNone(mc.merge_form_violation(cmd), cmd)

    def test_api_merges_without_gh_in_the_command_are_merge_attempts(self):
        for cmd in (
            "curl -sk -X PUT -H @/tmp/h https://140.82.121.6/repos/2anki/2anki.net/pulls/5184/merge",
            "wget --method=PUT https://140.82.121.6/repos/2anki/2anki.net/pulls/5184/merge",
            "curl -X POST -H @/tmp/h https://140.82.121.6/graphql -d @/tmp/mergePullRequest.json",
            "curl -X POST -H @/tmp/h https://140.82.121.6/graphql -d @/tmp/merge.json",
            "http PUT https://140.82.121.6/repos/2anki/2anki.net/pulls/5184/merge",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_gh_api_on_a_pulls_path_is_a_merge_attempt(self):
        self.assertTrue(mc.is_gh_pr_merge("gh api repos/2anki/2anki.net/pulls/5/files"))

    def test_the_graphql_merge_mutation_alone_is_a_merge_attempt_as_on_main(self):
        self.assertTrue(mc.is_gh_pr_merge("python3 /tmp/s.py mergePullRequest"))

    def test_auto_queue_and_branch_merge_apis_are_merge_attempts(self):
        for cmd in (
            "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input:{pullRequestId:\"PR_x\"}) { clientMutationId } }'",
            "curl -X POST -H @/tmp/h https://140.82.121.6/graphql -d '{\"query\":\"mutation { enablePullRequestAutoMerge(input:{}) { clientMutationId } }\"}'",
            "gh api graphql -f query='mutation { enqueuePullRequest(input:{}) { clientMutationId } }'",
            "gh api graphql -f query='mutation { mergeBranch(input:{}) { clientMutationId } }'",
            "gh api -X POST repos/2anki/2anki.net/merges -f base=main -f head=x",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_merge_with_a_dollar_or_backtick_is_a_merge_attempt_without_gh(self):
        for cmd in ('git merge "$tip"', "echo `merge`", "M=merge; echo $M", '"$G" pr merge 1'):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_every_escape_letter_and_decoder_is_a_merge_attempt(self):
        for cmd in (
            "printf '\\U00000067h pr \\x6derge 1' | zsh",
            "printf '\\c' | dash",
            "printf '\\x67h pr \\x6derge 1' | ksh",
            "printf '\\x67h' | xargs -I{} {} pr view 1",
            "printf '\\x67h pr \\x6derge 1' | /bin/bash",
            "x=$(printf '\\x67h'); echo",
            "x=`printf '\\x67h'`",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_a_decoded_payload_behind_a_long_run_of_pipes_is_a_merge_attempt(self):
        cmd = ": '" + "|" * 80000 + "'; printf '\\x67\\x68 pr \\x6d\\x65rge 1' | sh"
        self.assertTrue(mc.is_gh_pr_merge(cmd))

    def test_a_program_name_held_in_a_variable_is_a_merge_attempt(self):
        for cmd in (
            "G=gh; $G pr merge 1",
            "${G} pr merge 1",
            "`which gh` pr merge 1",
            "$G api repos/2anki/2anki.net/pulls/1/merge -X PUT",
            "$G pr view 1",
            "$G api repos/a/b/issues/1",
            "`which x` pr view 1",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_harmless_commands_the_broad_rules_still_deny(self):
        for cmd in (
            'B=$(git branch --show-current); gh pr view "$B"',
            'gh pr view "$N" --json headRefOid --jq .headRefOid',
            'gh pr create --repo 2anki/server --base main --head x --body "$(cat f.md)"',
            "gh pr review 5 --comment --body \"see `x`\"",
            "cd /Users/a/src/github.com/2anki/server && echo $(date)",
            "IFS=$'\\n' read -r line",
            "printf $'\\e[31mred\\n'",
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

    def test_ordinary_commands_are_not_merge_attempts(self):
        for cmd in ORDINARY_COMMANDS + (
            'git commit -m "docs: merge notes" -m "See https://github.com/2anki/server/pull/5193"',
            "gh api graphql -f query='{ repository(owner:\"2anki\", name:\"2anki.net\") { pullRequest(number:1) { state mergeCommit { oid } } } }'",
            "gh api repos/2anki/2anki.net/issues/5/events --jq '[.[] | select(.event==\"closed\") | .actor.login] | last'",
            "gh pr view 1 --json mergedAt,mergedBy",
            "cd /Users/a/src/github.com/2anki/server && echo $HOME",
            "python3 /Users/a/src/github.com/2anki/server/.claude/hooks/check-merge-status.test.py",
            "ssh h 'S=$(date -u +%FT%H); grep -c \"POST /api/apkg/pdf\" /tmp/x.log'",
            'tip=$(git rev-parse "$b")\nif git merge-base --is-ancestor "$tip" origin/main; then echo "MERGED $b"; fi',
            "curl https://example.com/merge-guide",
            "gh pr view fix/narrow-merge-scan --json state",
            "git status",
            "gh pr view 5193 --repo 2anki/server --json number,headRefOid,statusCheckRollup",
            "git log origin/main --format=%H -1 --grep='(#5193)'",
            "git fetch origin main && git rebase origin/main",
            "git branch -D fix/merge-hooks-full-file-list",
            "git merge-base --is-ancestor abc origin/main",
            "git push --force-with-lease origin fix/merge-hooks-full-file-list",
            "M=$(jq 'length' /tmp/overnight-backlog.json)",
            "npx playwright test $SPEC",
            "ls src | grep -c highlight && echo $?",
            "gh pr ready 5193",
        ):
            self.assertFalse(mc.is_gh_pr_merge(cmd), cmd)

    def test_non_strings_are_not_merge_attempts(self):
        for cmd in (None, 42):
            self.assertFalse(mc.is_gh_pr_merge(cmd), cmd)


MERGE_HOOKS = (
    "check-merge-status.py",
    "check-browser-attestation.py",
    "check-changelog-on-merge.py",
    "check-removed-for-users.py",
)


class TestTheFourHooksEndToEnd(unittest.TestCase):
    def run_hook(self, script, command):
        with tempfile.TemporaryDirectory() as bin_dir:
            marker = os.path.join(bin_dir, "gh-was-called")
            fake_gh = os.path.join(bin_dir, "gh")
            with open(fake_gh, "w") as handle:
                handle.write(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
            os.chmod(fake_gh, 0o755)
            env = {**os.environ, "PATH": bin_dir + os.pathsep + "/usr/bin:/bin"}
            env.pop("CLAUDE_SKIP_SAFETY", None)
            result = subprocess.run(
                [sys.executable, os.path.join(HOOKS_DIR, script)],
                input=json.dumps({"tool_name": "Bash", "tool_input": {"command": command}}),
                capture_output=True,
                text=True,
                env=env,
                timeout=30,
            )
            return result, os.path.exists(marker)

    def test_ordinary_commands_pass_every_merge_hook_without_calling_gh(self):
        for script in MERGE_HOOKS:
            for command in ORDINARY_COMMANDS:
                result, called_gh = self.run_hook(script, command)
                self.assertEqual(result.returncode, 0, (script, command, result.stderr))
                self.assertNotIn("permissionDecision", result.stdout, (script, command))
                self.assertFalse(called_gh, (script, command))

    def test_a_merge_named_next_to_gh_is_still_denied_by_every_merge_hook(self):
        for script in MERGE_HOOKS:
            result, called_gh = self.run_hook(script, 'gh pr edit 5 --title "docs: merge notes"')
            self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "deny", script)
            self.assertFalse(called_gh, script)


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
            ('git commit -m "docs: gh pr merge"', "contains `gh` and the word `merge`", "git commit -F"),
            ("grep -rn mergePullRequest src/", "merge mutation", "keep it out of the command"),
            ("gh api repos/a/b/pulls/1/files", "`pulls/` path with `gh api`", "gh pr view --json"),
            ('git merge "$tip"', "the word `merge` with a `$`", "write the value literally"),
            ('gh pr create --body "$(cat f.md)"', "`$(`", "--body-file"),
            ("IFS=$'\\n' read -r x", "ANSI-C quote", "plain quoted string"),
            ("printf '\\x67\\x68 pr' | sh", "character escape", "write the characters literally"),
            ("gh pr me$x 1", "a `$` or a backtick after `gh`", "write values literally"),
            ("$G pr view 1", "`pr` or `api` after a `$`", "program name and values literally"),
        ):
            message = mc.merge_form_violation(cmd)
            self.assertIn(reason, message, cmd)
            self.assertIn(fix, message, cmd)

    def test_every_ship_command_but_the_step_4_one_is_left_alone(self):
        with open(os.path.join(HOOKS_DIR, "..", "commands", "ship.md")) as handle:
            ship = handle.read()
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

    def test_every_command_block_in_the_changed_docs_is_left_alone(self):
        for name in (
            "commands/ship.md",
            "commands/deploy-status.md",
            "commands/cleanup.md",
            "commands/review-pr.md",
            "commands/overnight-prs.md",
            "commands/pr-visual-diff.md",
            "docs/follow-ups-project.md",
            "docs/prod-ops.md",
        ):
            with open(os.path.join(HOOKS_DIR, "..", name)) as handle:
                doc = handle.read()
            blocks = [
                match.group(1).strip()
                for match in re.finditer(r"```bash\n(.*?)```", doc, re.S)
                if not doc[: match.start()].rstrip().endswith("with the Write tool:")
            ]
            inline = [
                command
                for command in re.findall(r"(?<!`)`((?:gh|git) [^`]+)`(?!`)", doc)
                if not command.startswith("gh pr merge")
            ]
            self.assertGreater(len(blocks) + len(inline), 0, name)
            for command in blocks + inline:
                if mc.allowed_merge(command.replace("<n>", "42")) is None:
                    self.assertFalse(mc.is_gh_pr_merge(command), (name, command))

    def test_a_variable_title_or_body_never_reaches_the_sibling_hooks(self):
        for cmd in (
            'T=x; gh issue create --title "$T"',
            'gh pr create --title x --body "$B"',
            'gh pr create --title x --body-file "$F"',
            'gh pr edit 5 --body "${B}"',
        ):
            self.assertTrue(mc.is_gh_pr_merge(cmd), cmd)

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
