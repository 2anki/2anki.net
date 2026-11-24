#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HOOKS_DIR, "check-ship-review-ledger.py")
LEDGER_CLI = os.path.join(HOOKS_DIR, "ship_ledger.py")

ISOLATED_GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Ledger Test",
    "GIT_AUTHOR_EMAIL": "ledger@example.com",
    "GIT_COMMITTER_NAME": "Ledger Test",
    "GIT_COMMITTER_EMAIL": "ledger@example.com",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
}


def test_env():
    env = {**os.environ, **ISOLATED_GIT_ENV}
    env.pop("CLAUDE_SKIP_SAFETY", None)
    return env


class Repo:
    def __init__(self):
        self.path = tempfile.mkdtemp(prefix="ship-ledger-")
        self.git("init", "-q", "-b", "main")
        self.main = self.commit("base.txt", "base\n", "base")
        self.git("update-ref", "refs/remotes/origin/main", self.main)
        self.git("checkout", "-q", "-b", "feature")

    def cleanup(self):
        shutil.rmtree(self.path, ignore_errors=True)

    def git(self, *args):
        result = subprocess.run(
            ["git", *args], cwd=self.path, env=test_env(), capture_output=True, text=True, check=True
        )
        return result.stdout.strip()

    def commit(self, name, content, message):
        with open(os.path.join(self.path, name), "w", encoding="utf-8") as handle:
            handle.write(content)
        self.git("add", name)
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def move_main_and_rebase(self, branch_tip, branch_name):
        self.git("checkout", "-q", "main")
        new_main = self.commit("other.txt", "other " + branch_name + "\n", "main moves")
        self.git("update-ref", "refs/remotes/origin/main", new_main)
        self.git("checkout", "-q", "-b", branch_name)
        self.git("cherry-pick", branch_tip)
        return self.git("rev-parse", "HEAD")

    def record(self, pr, sha, verdict, scope):
        return subprocess.run(
            [sys.executable, LEDGER_CLI, "record", str(pr), sha, verdict, scope],
            cwd=self.path, env=test_env(), capture_output=True, text=True,
        )

    def ledger(self):
        return os.path.join(self.path, ".git", "ship-review-ledger")

    def write(self, name, content):
        path = os.path.join(self.path, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        return path

    def marker_file(self, sha, name="ship-marker.md"):
        return self.write(name, f"Clean review.\n\n<!-- ship-review: pass sha={sha} -->\n")

    def run_hook(self, command, tool_name="Bash"):
        payload = json.dumps({"tool_name": tool_name, "tool_input": {"command": command}, "cwd": self.path})
        result = subprocess.run(
            [sys.executable, HOOK], input=payload, cwd=self.path, env=test_env(), capture_output=True, text=True,
        )
        return json.loads(result.stdout)


def decision(output):
    return output.get("hookSpecificOutput", {}).get("permissionDecision", "allow")


def reason(output):
    return output.get("hookSpecificOutput", {}).get("permissionDecisionReason", "")


def post(pr, path):
    return f"gh pr review {pr} --repo 2anki/server --comment --body-file {path}"


class LedgerTestCase(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.cleanup)
        self.first = self.repo.commit("change.txt", "first\n", "feat: first")

    def assertAllowed(self, command):
        output = self.repo.run_hook(command)
        self.assertEqual(output, {"continue": True}, reason(output))

    def assertDenied(self, command, *fragments):
        output = self.repo.run_hook(command)
        self.assertEqual(decision(output), "deny", output)
        for fragment in fragments:
            self.assertIn(fragment, reason(output))


class MarkerRefusedTest(LedgerTestCase):
    def test_refuses_a_marker_with_no_ledger_entry(self):
        self.assertFalse(os.path.exists(self.repo.ledger()))
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "no pass recorded", "ship_ledger.py record")

    def test_refuses_when_the_only_entry_for_the_sha_is_a_block(self):
        self.repo.record(5, self.first, "block", "security")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "`security` block")

    def test_refuses_a_pass_and_a_block_for_the_same_sha(self):
        self.repo.record(5, self.first, "pass", "engineering")
        self.repo.record(5, self.first, "block", "security")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "`security` block")

    def test_refuses_a_new_head_after_an_earlier_block_with_no_pass_for_it(self):
        self.repo.record(5, self.first, "block", "security")
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.assertDenied(post(5, self.repo.marker_file(fixed)), "no pass recorded")

    def test_refuses_a_fix_passed_only_by_another_scope(self):
        self.repo.record(5, self.first, "block", "security")
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.repo.record(5, fixed, "pass", "engineering")
        self.assertDenied(post(5, self.repo.marker_file(fixed)), "no `security` pass")

    def test_refuses_a_pass_recorded_before_the_block_it_must_answer(self):
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.repo.record(5, fixed, "pass", "security")
        self.repo.record(5, self.first, "block", "security")
        self.assertDenied(post(5, self.repo.marker_file(fixed)), "no `security` pass")


class MarkerAllowedTest(LedgerTestCase):
    def test_allows_a_pass_for_the_sha(self):
        self.repo.record(5, self.first, "pass", "security")
        self.assertAllowed(post(5, self.repo.marker_file(self.first)))

    def test_allows_block_then_fix_then_pass(self):
        self.repo.record(5, self.first, "pass", "engineering")
        self.repo.record(5, self.first, "block", "security")
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.repo.record(5, fixed, "pass", "engineering")
        self.repo.record(5, fixed, "pass", "security")
        self.assertAllowed(post(5, self.repo.marker_file(fixed)))

    def test_allows_the_forms_ship_uses(self):
        self.repo.record(5, self.first, "pass", "security")
        marker = self.repo.marker_file(self.first)
        for command in (
            f"gh pr review 5 --comment --body-file {marker}",
            f"gh pr review 5 --repo 2anki/2anki.net --comment --body-file {marker}",
            f"gh pr review 5 --repo 2anki/server --comment --body-file {marker} 2>&1",
            "gh pr review 5 --repo 2anki/server --comment --body-file ship-marker.md",
        ):
            self.assertAllowed(command)


class PatchIdTest(LedgerTestCase):
    def test_a_rebase_that_keeps_the_patch_keeps_the_pass(self):
        self.repo.record(5, self.first, "pass", "security")
        rebased = self.repo.move_main_and_rebase(self.first, "rebased")
        self.assertNotEqual(rebased, self.first)
        self.assertAllowed(post(5, self.repo.marker_file(rebased)))

    def test_a_rebase_that_changes_the_patch_needs_a_review(self):
        self.repo.record(5, self.first, "pass", "security")
        rebased = self.repo.move_main_and_rebase(self.first, "rebased")
        changed = self.repo.commit("change.txt", "changed in the rebase\n", "fix: more")
        self.assertNotEqual(changed, rebased)
        self.assertDenied(post(5, self.repo.marker_file(changed)), "no pass recorded")

    def test_a_rebase_does_not_launder_a_block(self):
        self.repo.record(5, self.first, "block", "security")
        rebased = self.repo.move_main_and_rebase(self.first, "rebased")
        self.repo.record(5, rebased, "pass", "security")
        self.assertDenied(post(5, self.repo.marker_file(rebased)), "same change")

    def test_records_the_patch_id_beside_the_sha(self):
        result = self.repo.record(5, self.first, "pass", "security")
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(self.repo.ledger(), encoding="utf-8") as ledger:
            fields = ledger.read().rstrip("\n").split("\t")
        self.assertEqual(fields[1:5], ["5", self.first, "pass", "security"])
        self.assertRegex(fields[5], r"^[0-9a-f]{40}$")

    def test_an_unknown_sha_is_recorded_without_a_patch_id_and_matches_only_itself(self):
        unknown = "c" * 40
        result = self.repo.record(5, unknown, "pass", "security")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no patch-id", result.stdout)
        self.assertAllowed(post(5, self.repo.marker_file(unknown)))
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "no pass recorded")


class OtherPrTest(LedgerTestCase):
    def test_a_block_on_another_pr_does_not_affect_this_one(self):
        self.repo.record(7, self.first, "block", "security")
        self.repo.record(5, self.first, "pass", "security")
        self.assertAllowed(post(5, self.repo.marker_file(self.first)))

    def test_a_pass_on_another_pr_does_not_count_for_this_one(self):
        self.repo.record(7, self.first, "pass", "security")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "no pass recorded for PR 5")


class UntouchedCommandsTest(LedgerTestCase):
    def test_reviews_and_comments_without_a_marker_pass(self):
        plain = self.repo.write("plain.md", "Looks good, one nit.\n")
        for command in (
            f"gh pr review 5 --repo 2anki/server --comment --body-file {plain}",
            f"gh pr comment 5 --repo 2anki/server --body-file {plain}",
            "gh pr comment 5 --repo 2anki/server --body 'lgtm'",
            "gh pr review 5 --repo 2anki/server --comment --body 'see the ship-review syntax in ship.md'",
        ):
            self.assertAllowed(command)

    def test_commands_that_do_not_post_a_review_or_comment_pass(self):
        marker = self.repo.marker_file(self.first, "ship-review-marker.md")
        for command in (
            f"git commit -F {marker}",
            f"cat {marker}",
            f"gh pr create --repo 2anki/server --base main --head ci/x --body-file {marker}",
            f"gh pr edit 5 --repo 2anki/server --body-file {marker}",
        ):
            self.assertAllowed(command)

    def test_other_tools_pass(self):
        output = self.repo.run_hook(post(5, self.repo.marker_file(self.first)), tool_name="Write")
        self.assertEqual(output, {"continue": True})


class MarkerFormTest(LedgerTestCase):
    def test_a_marker_posted_as_a_comment_is_refused_even_with_a_pass(self):
        self.repo.record(5, self.first, "pass", "security")
        marker = self.repo.marker_file(self.first)
        self.assertDenied(f"gh pr comment 5 --repo 2anki/server --body-file {marker}", "form /ship does not use")

    def test_an_inline_marker_is_refused(self):
        self.repo.record(5, self.first, "pass", "security")
        command = f"gh pr review 5 --comment --body '<!-- ship-review: pass sha={self.first} -->'"
        self.assertDenied(command, "form /ship does not use")

    def test_a_marker_sent_through_the_api_is_refused(self):
        self.repo.record(5, self.first, "pass", "security")
        marker = self.repo.marker_file(self.first)
        self.assertDenied(f"gh api repos/2anki/2anki.net/issues/5/comments -F body=@{marker}", "form /ship does not use")


class DependabotTest(LedgerTestCase):
    def test_the_hook_reads_no_author_so_a_dependabot_marker_needs_a_ledger_pass_like_any_other(self):
        self.assertDenied(post(9, self.repo.marker_file(self.first)), "no pass recorded for PR 9")
        self.repo.record(9, self.first, "pass", "engineering")
        self.assertAllowed(post(9, self.repo.marker_file(self.first)))


class FailClosedTest(LedgerTestCase):
    def test_an_unreadable_ledger_denies(self):
        os.makedirs(self.repo.ledger())
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "ledger check failed")

    def test_outside_a_git_checkout_denies(self):
        outside = tempfile.mkdtemp(prefix="ship-ledger-outside-")
        self.addCleanup(shutil.rmtree, outside, True)
        marker = os.path.join(outside, "m.md")
        with open(marker, "w", encoding="utf-8") as handle:
            handle.write(f"<!-- ship-review: pass sha={self.first} -->\n")
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": post(5, marker)}, "cwd": outside})
        env = {**test_env(), "GIT_CEILING_DIRECTORIES": os.path.dirname(outside)}
        result = subprocess.run([sys.executable, HOOK], input=payload, cwd=outside, env=env,
                                capture_output=True, text=True)
        output = json.loads(result.stdout)
        self.assertEqual(decision(output), "deny")
        self.assertIn("could not find this checkout's git dir", reason(output))


class RecordCommandTest(LedgerTestCase):
    def test_rejects_bad_input_and_writes_nothing(self):
        for args in ((5, self.first[:7], "pass", "security"), (5, self.first, "ok", "security"),
                     ("x", self.first, "pass", "security"), (5, self.first, "pass", "Security Review")):
            result = self.repo.record(*args)
            self.assertEqual(result.returncode, 2, args)
        self.assertFalse(os.path.exists(self.repo.ledger()))

    def test_the_record_command_passes_the_merge_hooks(self):
        sys.path.insert(0, HOOKS_DIR)
        import merge_command

        command = f"python3 .claude/hooks/ship_ledger.py record 5 {self.first} block ux-voice"
        self.assertFalse(merge_command.is_gh_pr_merge(command))


if __name__ == "__main__":
    unittest.main()
