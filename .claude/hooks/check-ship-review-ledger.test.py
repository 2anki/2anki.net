#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HOOKS_DIR, "check-ship-review-ledger.py")
LEDGER_CLI = os.path.join(HOOKS_DIR, "ship_ledger.py")
sys.path.insert(0, HOOKS_DIR)

import ship_ledger  # noqa: E402

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
        full = os.path.join(self.path, name)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(content)
        self.git("add", name)
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def branch_from_main(self, name):
        self.git("checkout", "-q", "-b", name, self.main)

    def move_main_and_rebase(self, branch_tip, branch_name):
        self.git("checkout", "-q", "main")
        new_main = self.commit("other.txt", "other " + branch_name + "\n", "main moves")
        self.main = new_main
        self.git("update-ref", "refs/remotes/origin/main", new_main)
        self.git("checkout", "-q", "-b", branch_name)
        self.git("cherry-pick", branch_tip)
        return self.git("rev-parse", "HEAD")

    def commit_on_main(self, name, content, message):
        self.git("checkout", "-q", "main")
        sha = self.commit(name, content, message)
        self.main = sha
        self.git("update-ref", "refs/remotes/origin/main", sha)
        return sha

    def revert_on_main(self, commit):
        self.git("checkout", "-q", "main")
        self.git("revert", "--no-edit", commit)
        self.main = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.main)
        return self.main

    def revert_branch(self, branch_name, commit):
        self.git("checkout", "-q", "-b", branch_name, self.main)
        self.git("revert", "--no-edit", commit)
        return self.git("rev-parse", "HEAD")

    def record(self, pr, sha, verdict, scope):
        return subprocess.run(
            [sys.executable, LEDGER_CLI, "record", str(pr), sha, verdict, scope],
            cwd=self.path, env=test_env(), capture_output=True, text=True,
        )

    def passes(self, pr, sha, *scopes):
        for scope in scopes:
            result = self.record(pr, sha, "pass", scope)
            assert result.returncode == 0, result.stderr

    def ledger(self):
        return os.path.join(self.path, ".git", "ship-review-ledger")

    def write(self, name, content):
        path = os.path.join(self.path, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        return path

    def marker_file(self, sha, name="ship-marker.md"):
        return self.write(name, f"Clean review.\n\n<!-- ship-review: pass sha={sha} -->\n")

    def run_hook_raw(self, stdin_bytes, hook=HOOK):
        result = subprocess.run(
            [sys.executable, hook], input=stdin_bytes, cwd=self.path, env=test_env(), capture_output=True,
        )
        return result.returncode, json.loads(result.stdout.decode("utf-8"))

    def run_hook(self, command, tool_name="Bash", hook=HOOK):
        payload = json.dumps({"tool_name": tool_name, "tool_input": {"command": command}, "cwd": self.path})
        code, output = self.run_hook_raw(payload.encode("utf-8"), hook)
        assert code == 0, code
        return output


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
        self.assertEqual(decision(output), "deny", (command, output))
        for fragment in fragments:
            self.assertIn(fragment, reason(output))


class MarkerRefusedTest(LedgerTestCase):
    def test_refuses_a_marker_with_no_ledger_entry(self):
        self.assertFalse(os.path.exists(self.repo.ledger()))
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "no `engineering` pass", "ship_ledger.py record")

    def test_refuses_when_the_only_entry_for_the_sha_is_a_block(self):
        self.repo.record(5, self.first, "block", "engineering")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "`engineering` block")

    def test_refuses_a_pass_and_a_block_for_the_same_sha(self):
        self.repo.passes(5, self.first, "engineering")
        self.repo.record(5, self.first, "block", "reach")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "`reach` block")

    def test_refuses_a_new_head_after_an_earlier_block_with_no_pass_for_it(self):
        self.repo.record(5, self.first, "block", "engineering")
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.assertDenied(post(5, self.repo.marker_file(fixed)), "no `engineering` pass")

    def test_refuses_a_fix_passed_only_by_another_scope(self):
        self.repo.record(5, self.first, "block", "reach")
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.repo.passes(5, fixed, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(fixed)), "no `reach` pass")

    def test_refuses_a_pass_recorded_before_the_block_it_must_answer(self):
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.repo.passes(5, fixed, "engineering")
        self.repo.record(5, self.first, "block", "engineering")
        self.assertDenied(post(5, self.repo.marker_file(fixed)), "no `engineering` pass for")


class MarkerAllowedTest(LedgerTestCase):
    def test_allows_an_engineering_pass_for_the_sha(self):
        self.repo.passes(5, self.first, "engineering")
        self.assertAllowed(post(5, self.repo.marker_file(self.first)))

    def test_allows_block_then_fix_then_pass(self):
        self.repo.passes(5, self.first, "engineering")
        self.repo.record(5, self.first, "block", "reach")
        fixed = self.repo.commit("change.txt", "fixed\n", "fix: finding")
        self.repo.passes(5, fixed, "engineering", "reach")
        self.assertAllowed(post(5, self.repo.marker_file(fixed)))

    def test_allows_the_forms_ship_uses(self):
        self.repo.passes(5, self.first, "engineering")
        marker = self.repo.marker_file(self.first)
        for command in (
            f"gh pr review 5 --comment --body-file {marker}",
            f"gh pr review 5 --repo 2anki/2anki.net --comment --body-file {marker}",
            f"gh pr review 5 --repo 2anki/server --comment --body-file {marker} 2>&1",
            "gh pr review 5 --repo 2anki/server --comment --body-file ship-marker.md",
        ):
            self.assertAllowed(command)


class RequiredScopeTest(LedgerTestCase):
    def test_a_security_pass_alone_does_not_cover_engineering(self):
        self.repo.passes(5, self.first, "security", "reach")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "no `engineering` pass")

    def test_a_rail_path_also_needs_a_security_pass(self):
        self.repo.branch_from_main("auth")
        rail = self.repo.commit("src/services/AuthenticationService.ts", "export {};\n", "chore: auth")
        self.repo.passes(5, rail, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(rail)), "no `security` pass")
        self.repo.passes(5, rail, "security")
        self.assertAllowed(post(5, self.repo.marker_file(rail)))

    def test_a_migration_needs_engineering_security_and_migration(self):
        for path in ("migrations/20260101_add.js", "src/data_layer/public/public/Users.ts"):
            self.repo.branch_from_main("m-" + path.replace("/", "-"))
            change = self.repo.commit(path, "exports.up = () => {};\n", "chore: schema")
            self.assertEqual(
                ship_ledger.required_scopes(change, self.repo.path), ("engineering", "security", "migration")
            )
        self.repo.passes(5, change, "engineering", "security")
        self.assertDenied(post(5, self.repo.marker_file(change)), "no `migration` pass")
        self.repo.passes(5, change, "migration")
        self.assertAllowed(post(5, self.repo.marker_file(change)))

    def test_a_feat_or_fix_touching_source_needs_reach(self):
        for path, subject in (("src/lib/cards.ts", "feat: cards"), ("web/src/App.tsx", "fix(web): app")):
            self.repo.branch_from_main("r-" + path.replace("/", "-"))
            change = self.repo.commit(path, "export const x = 1;\n", subject)
            self.assertEqual(ship_ledger.required_scopes(change, self.repo.path), ("engineering", "reach"), path)
        self.repo.passes(5, change, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(change)), "no `reach` pass")
        self.repo.passes(5, change, "reach")
        self.assertAllowed(post(5, self.repo.marker_file(change)))

    def test_reach_is_not_needed_for_a_chore_or_for_files_outside_source(self):
        self.repo.branch_from_main("chore-src")
        chore = self.repo.commit("src/lib/cards.ts", "export const x = 1;\n", "chore: tidy")
        self.assertEqual(ship_ledger.required_scopes(chore, self.repo.path), ("engineering",))
        self.assertEqual(ship_ledger.required_scopes(self.first, self.repo.path), ("engineering",))

    def test_a_fix_title_over_chore_commits_needs_reach(self):
        self.repo.branch_from_main("titled")
        chore = self.repo.commit("src/lib/cards.ts", "export const x = 1;\n", "chore: tidy")
        self.assertEqual(
            ship_ledger.required_scopes(chore, self.repo.path, ["fix: keep the cards"]), ("engineering", "reach")
        )
        self.repo.passes(5, chore, "engineering")
        self.assertIsNone(ship_ledger.head_violation("5", chore, self.repo.path))
        self.assertIn("no `reach` pass", ship_ledger.head_violation("5", chore, self.repo.path, ["fix: keep the cards"]))

    def test_unreadable_subjects_require_reach(self):
        self.assertTrue(ship_ledger.needs_reach(["src/lib/cards.ts"], None))
        self.assertFalse(ship_ledger.needs_reach(["docs/x.md"], None))

    def test_a_rail_content_hit_also_needs_a_security_pass(self):
        hit = self.repo.commit("src/lib/limits.ts", "export const x = process.env.SECRET;\n", "feat: secret")
        self.repo.passes(5, hit, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(hit)), "no `security` pass")

    def test_an_unreadable_change_needs_all_four(self):
        unknown = "c" * 40
        self.repo.passes(5, unknown, "engineering", "security", "migration")
        self.assertDenied(post(5, self.repo.marker_file(unknown)), "no `reach` pass")
        self.repo.passes(5, unknown, "reach")
        self.assertAllowed(post(5, self.repo.marker_file(unknown)))

    def test_required_scopes_reads_the_classifier(self):
        self.assertEqual(ship_ledger.required_scopes(self.first, self.repo.path), ("engineering",))
        self.assertEqual(ship_ledger.required_scopes("d" * 40, self.repo.path), ship_ledger.SCOPES)


class PatchIdTest(LedgerTestCase):
    def test_a_rebase_that_keeps_the_patch_keeps_the_pass(self):
        self.repo.passes(5, self.first, "engineering")
        rebased = self.repo.move_main_and_rebase(self.first, "rebased")
        self.assertNotEqual(rebased, self.first)
        self.assertAllowed(post(5, self.repo.marker_file(rebased)))

    def test_a_rebase_that_changes_the_patch_needs_a_review(self):
        self.repo.passes(5, self.first, "engineering")
        self.repo.move_main_and_rebase(self.first, "rebased")
        changed = self.repo.commit("change.txt", "changed in the rebase\n", "fix: more")
        self.assertDenied(post(5, self.repo.marker_file(changed)), "no `engineering` pass")

    def test_a_rebase_does_not_launder_a_block(self):
        self.repo.record(5, self.first, "block", "engineering")
        rebased = self.repo.move_main_and_rebase(self.first, "rebased")
        self.repo.passes(5, rebased, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(rebased)), "same change")

    def whitespace_pair(self, reviewed, later):
        self.repo.branch_from_main("reviewed")
        first = self.repo.commit("code.py", reviewed, "feat: code")
        self.repo.branch_from_main("later")
        second = self.repo.commit("code.py", later, "feat: code")
        return first, second

    def test_a_space_added_inside_a_string_needs_a_review(self):
        first, second = self.whitespace_pair('PATH = "data/cards.csv"\n', 'PATH = "data/ cards.csv"\n')
        self.assertNotEqual(ship_ledger.patch_id(first, self.repo.path), ship_ledger.patch_id(second, self.repo.path))
        self.repo.passes(5, first, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(second)), "no `engineering` pass")

    def test_a_line_dedented_out_of_an_if_needs_a_review(self):
        first, second = self.whitespace_pair(
            "if ready:\n    check()\n    send()\n", "if ready:\n    check()\nsend()\n"
        )
        self.assertNotEqual(ship_ledger.patch_id(first, self.repo.path), ship_ledger.patch_id(second, self.repo.path))
        self.repo.passes(5, first, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(second)), "no `engineering` pass")

    def test_records_a_verbatim_patch_id_beside_the_sha(self):
        self.repo.passes(5, self.first, "engineering")
        with open(self.repo.ledger(), encoding="utf-8") as ledger:
            fields = ledger.read().rstrip("\n").split("\t")
        self.assertEqual(fields[1:5], ["5", self.first, "pass", "engineering"])
        diff = self.repo.git("diff", self.repo.main, self.first) + "\n"
        verbatim = subprocess.run(
            ["git", "patch-id", "--verbatim"], input=diff, cwd=self.repo.path, capture_output=True, text=True
        ).stdout.split()[0]
        self.assertEqual(fields[5], verbatim)

    def test_an_unknown_sha_is_recorded_without_a_patch_id(self):
        result = self.repo.record(5, "c" * 40, "pass", "engineering")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no patch-id", result.stdout)


class OldGitTest(LedgerTestCase):
    def test_verbatim_needs_git_2_39(self):
        self.assertFalse(ship_ledger.supports_verbatim((2, 38)))
        self.assertFalse(ship_ledger.supports_verbatim(None))
        self.assertTrue(ship_ledger.supports_verbatim((2, 39)))
        self.assertTrue(ship_ledger.supports_verbatim((3, 0)))

    def test_an_old_git_falls_back_to_the_exact_sha_not_to_stable(self):
        rebased = self.repo.move_main_and_rebase(self.first, "rebased")
        with mock.patch.object(ship_ledger, "git_version", return_value=(2, 38)):
            self.assertIsNone(ship_ledger.patch_id(rebased, self.repo.path))
            entries = [ship_ledger.Entry("5", self.first, "pass", "engineering", None)]
            patch = ship_ledger.patch_id(rebased, self.repo.path)
        self.assertIn("no `engineering` pass", ship_ledger.marker_violation(entries, "5", rebased, patch, ("engineering",)))
        self.assertIsNone(ship_ledger.marker_violation(entries, "5", self.first, patch, ("engineering",)))

    def test_reads_the_installed_git_version(self):
        version = ship_ledger.git_version(self.repo.path)
        self.assertIsInstance(version, tuple)
        self.assertEqual(len(version), 2)


class OtherPrTest(LedgerTestCase):
    def test_a_block_on_another_pr_does_not_affect_this_one(self):
        self.repo.record(7, self.first, "block", "engineering")
        self.repo.passes(5, self.first, "engineering")
        self.assertAllowed(post(5, self.repo.marker_file(self.first)))

    def test_a_pass_on_another_pr_does_not_count_for_this_one(self):
        self.repo.passes(7, self.first, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "no `engineering` pass recorded for PR 5")


class BodyFileTest(LedgerTestCase):
    def test_the_reviewers_bypasses_are_refused_even_with_a_pass(self):
        self.repo.passes(7, self.first, "engineering")
        self.repo.marker_file(self.first, "m.md")
        for command in (
            "cat m.md | gh pr review 7 --comment --body-file -",
            "gh pr review 7 --comment --body-file - < m.md",
            "gh pr review 7 --comment --body-file /dev/stdin < m.md",
            "gh pr review 7 --comment --body-file m.md; echo x",
            "cp m.md other.md && gh pr review 7 --comment --body-file other.md",
        ):
            self.assertDenied(command, "Refusing this command")

    def test_the_reviewers_bypasses_are_refused_with_an_empty_ledger(self):
        self.repo.marker_file(self.first, "m.md")
        for command in (
            "cat m.md | gh pr review 7 --comment --body-file -",
            "gh pr review 7 --comment --body-file - < m.md",
            "gh pr review 7 --comment --body-file /dev/stdin < m.md",
            "gh pr review 7 --comment --body-file m.md; echo x",
            "cp m.md other.md && gh pr review 7 --comment --body-file other.md",
        ):
            self.assertDenied(command, "Refusing this command")

    def test_stdin_devices_and_missing_files_are_refused_alone_too(self):
        for command in (
            "gh pr review 7 --comment --body-file -",
            "gh pr review 7 --comment --body-file=-",
            "gh pr review 7 --comment -F -",
            "gh pr review 7 --comment -F-",
            "gh pr review 7 --comment --body-file /dev/stdin",
            "gh pr review 7 --comment --body-file /dev/fd/0",
            "gh pr review 7 --comment --body-file /proc/self/fd/0",
            "gh pr review 7 --comment --body-file missing.md",
            f"gh pr review 7 --comment --body-file {self.repo.path}",
            "gh pr comment 7 --body-file missing.md",
            "gh pr review 7 --comment --body-file",
        ):
            self.assertDenied(command, "body file")

    def test_a_plain_body_file_post_must_be_alone_in_its_call(self):
        plain = self.repo.write("plain.md", "Looks good, one nit.\n")
        for command in (
            f"gh pr comment 7 --repo 2anki/server --body-file {plain} | tail -1",
            f"gh pr review 7 --comment --body-file {plain} && echo done",
            f"gh pr comment 7 --body-file {plain} > out.txt",
            f"gh pr comment 7 --body-file {plain}\necho next",
        ):
            self.assertDenied(command, "not alone")

    def test_a_marker_through_a_symlink_to_a_device_is_refused(self):
        link = os.path.join(self.repo.path, "link.md")
        os.symlink("/dev/stdin", link)
        self.assertDenied("gh pr review 7 --comment --body-file link.md", "body file")

    def test_the_documented_plain_forms_pass(self):
        plain = self.repo.write("plain.md", "Looks good, one nit.\n")
        for command in (
            f"gh pr review 7 --repo 2anki/server --comment --body-file {plain}",
            f"gh pr comment 7 --repo 2anki/server --body-file {plain}",
            f"gh pr comment 7 --repo 2anki/server --body-file {plain} 2>&1",
            "gh pr review 7 --comment --body-file plain.md",
        ):
            self.assertAllowed(command)


class UntouchedCommandsTest(LedgerTestCase):
    def test_inline_reviews_and_comments_without_a_marker_pass(self):
        for command in (
            "gh pr comment 5 --repo 2anki/server --body 'lgtm'",
            "gh pr review 5 --repo 2anki/server --comment --body 'see the ship-review syntax in ship.md'",
            "gh issue comment 5 --repo 2anki/server --body 'Reverted in the follow-up PR'",
            "gh pr view 5 --repo 2anki/server --json reviews,comments | head -5",
            "gh api graphql -F number=5 -f query='{ viewer { login } }'",
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

    def test_a_short_fake_sha_in_prose_is_not_a_marker(self):
        example = self.repo.write("example.md", "The marker looks like `<!-- ship-review: pass sha=abc1234 -->`.\n")
        self.assertAllowed(f"gh pr comment 5 --repo 2anki/server --body-file {example}")
        self.assertAllowed("gh pr comment 5 --body 'format: <!-- ship-review: pass sha=abc1234 -->'")

    def test_other_tools_pass(self):
        output = self.repo.run_hook(post(5, self.repo.marker_file(self.first)), tool_name="Write")
        self.assertEqual(output, {"continue": True})


class MarkerFormTest(LedgerTestCase):
    def test_a_marker_posted_as_a_comment_is_refused_even_with_a_pass(self):
        self.repo.passes(5, self.first, "engineering")
        marker = self.repo.marker_file(self.first)
        self.assertDenied(f"gh pr comment 5 --repo 2anki/server --body-file {marker}", "form /ship does not use")

    def test_an_inline_marker_is_refused(self):
        self.repo.passes(5, self.first, "engineering")
        command = f"gh pr review 5 --comment --body '<!-- ship-review: pass sha={self.first} -->'"
        self.assertDenied(command, "form /ship does not use")

    def test_a_marker_sent_through_the_api_is_refused(self):
        self.repo.passes(5, self.first, "engineering")
        marker = self.repo.marker_file(self.first)
        self.assertDenied(f"gh api repos/2anki/2anki.net/issues/5/comments -F body=@{marker}", "form /ship does not use")
        self.assertDenied(f"gh api repos/2anki/2anki.net/issues/5/comments --input {marker}", "form /ship does not use")


class QuoteSplitMarkerTest(LedgerTestCase):
    def test_a_marker_split_across_shell_quotes_is_still_a_marker(self):
        self.repo.passes(7, self.first, "engineering")
        head, tail = self.first[:20], self.first[20:]
        for command in (
            f"gh pr review 7 --comment --body '<!-- ship-review: pass sha='{self.first}' -->'",
            f"gh pr review 7 --comment --body '<!-- ship-review: pass sha={head}''{tail} -->'",
            f"gh pr review 7 --comment --body \"<!-- ship-review: pass sha=\"{head}\"{tail} -->\"",
            f"gh api repos/2anki/2anki.net/issues/7/comments -f body='<!-- ship-review: pass sha='{self.first}' -->'",
            f"gh api repos/2anki/2anki.net/issues/7/comments -f body='<!-- ship-review: '\"pass sha={head}\"'{tail} -->'",
        ):
            self.assertDenied(command, "form /ship does not use")


class AliasAndExtensionTest(LedgerTestCase):
    def test_defining_a_gh_command_is_refused(self):
        for command in (
            "gh alias set rv 'pr review'",
            "gh alias set --shell rv 'gh pr review 7 --comment --body-file m.md'",
            "gh alias import aliases.yml",
            "gh extension install someone/gh-review",
            "gh extension create gh-review",
            "gh ext install someone/gh-review",
            "gh extensions create gh-review",
        ):
            self.assertDenied(command, "no hook reads")

    def test_listing_aliases_and_extensions_passes(self):
        for command in ("gh alias list", "gh extension list", "gh alias delete rv"):
            self.assertAllowed(command)

    def test_the_words_elsewhere_in_a_command_are_not_a_definition(self):
        for command in (
            "gh issue create --repo 2anki/server --title 'Add an install hint' --label extension",
            "gh label create extension --repo 2anki/server",
            "gh issue create --repo 2anki/server --title 'alias set fails' --label bug",
        ):
            self.assertAllowed(command)
        self.assertDenied("ls && gh ext create gh-review", "no hook reads")


class AnyGhBodyFileTest(LedgerTestCase):
    def test_the_body_file_rule_applies_whatever_the_subcommand(self):
        for command in (
            "gh pr create --repo 2anki/server --base main --head ci/x --body-file missing.md",
            "gh pr edit 7 --repo 2anki/server --body-file -",
            "gh issue create --title x --body-file /dev/stdin",
            "gh release create v1 -F missing-notes.md",
        ):
            self.assertDenied(command, "body file")
        body = self.repo.write("body.md", "A body.\n")
        self.assertDenied(f"gh pr create --repo 2anki/server --base main --head ci/x --body-file {body} | cat", "not alone")

    def test_a_field_flag_is_not_a_file(self):
        self.assertAllowed("gh workflow run deploy.yml -F ref=main")


class ExactRevertTest(LedgerTestCase):
    def head_violation(self, sha, pr="8"):
        return ship_ledger.head_violation(pr, sha, self.repo.path)

    def test_an_exact_revert_passes_with_an_empty_ledger(self):
        landed = self.repo.commit_on_main("src/lib/cards.ts", "export const broken = 1;\n", "feat: cards")
        revert = self.repo.revert_branch("revert-cards", landed)
        self.assertEqual(ship_ledger.reverted_commit(revert, self.repo.path), landed)
        self.assertIsNone(self.head_violation(revert))
        self.assertAllowed(post(8, self.repo.marker_file(revert)))

    def test_an_exact_revert_of_an_older_commit_inside_the_window_passes(self):
        landed = self.repo.commit_on_main("src/lib/cards.ts", "export const broken = 1;\n", "feat: cards")
        for index in range(5):
            self.repo.commit_on_main(f"notes/{index}.txt", f"{index}\n", "docs: note")
        revert = self.repo.revert_branch("revert-cards", landed)
        self.assertIsNone(self.head_violation(revert))

    def test_a_revert_with_one_extra_changed_line_needs_the_review(self):
        landed = self.repo.commit_on_main("src/lib/cards.ts", "export const broken = 1;\n", "feat: cards")
        self.repo.revert_branch("revert-cards", landed)
        extra = self.repo.commit("src/lib/other.ts", "export const extra = 2;\n", "fix: extra")
        self.assertIsNone(ship_ledger.reverted_commit(extra, self.repo.path))
        self.assertIn("no `engineering` pass", self.head_violation(extra))

    def test_a_revert_touching_a_migration_needs_the_review(self):
        landed = self.repo.commit_on_main("migrations/20260101_add.js", "exports.up = () => {};\n", "feat: table")
        revert = self.repo.revert_branch("revert-table", landed)
        self.assertIsNone(ship_ledger.reverted_commit(revert, self.repo.path))
        self.assertIn("no `engineering` pass", self.head_violation(revert))

    def test_a_revert_of_a_commit_older_than_the_window_needs_the_review(self):
        landed = self.repo.commit_on_main("src/lib/cards.ts", "export const broken = 1;\n", "feat: cards")
        for index in range(ship_ledger.REVERT_WINDOW):
            self.repo.commit_on_main(f"notes/{index}.txt", f"{index}\n", "docs: note")
        revert = self.repo.revert_branch("revert-cards", landed)
        self.assertIsNone(ship_ledger.reverted_commit(revert, self.repo.path))
        self.assertIn("no `engineering` pass", self.head_violation(revert))

    def test_a_revert_of_a_revert_is_a_re_land_and_needs_the_review(self):
        landed = self.repo.commit_on_main("src/lib/cards.ts", "export const broken = 1;\n", "chore: cards")
        rolled_back = self.repo.revert_on_main(landed)
        re_land = self.repo.revert_branch("re-land-cards", rolled_back)
        self.assertIsNone(ship_ledger.reverted_commit(re_land, self.repo.path))
        self.assertIn("no `engineering` pass", self.head_violation(re_land))
        self.assertDenied(post(8, self.repo.marker_file(re_land)), "no `engineering` pass")

    def test_a_re_land_of_a_commit_far_older_than_any_window_needs_the_review(self):
        landed = self.repo.commit_on_main("src/lib/cards.ts", "export const surface = 1;\n", "chore: surface")
        self.repo.git("checkout", "-q", "main")
        for index in range(205):
            self.repo.git("commit", "-q", "--allow-empty", "-m", f"chore: filler {index}")
        self.repo.main = self.repo.git("rev-parse", "HEAD")
        self.repo.git("update-ref", "refs/remotes/origin/main", self.repo.main)
        removed = self.repo.revert_on_main(landed)
        re_land = self.repo.revert_branch("re-land-surface", removed)
        self.assertIsNone(ship_ledger.reverted_commit(re_land, self.repo.path))
        self.assertIn("no `engineering` pass", self.head_violation(re_land))

    def test_a_pure_emergency_revert_of_the_newest_commit_needs_no_scope(self):
        self.repo.commit_on_main("src/lib/cards.ts", "export const ok = 1;\n", "feat: cards")
        newest = self.repo.commit_on_main("src/lib/cards.ts", "export const ok = 2;\n", "fix: cards")
        revert = self.repo.revert_branch("revert-newest", newest)
        self.assertEqual(ship_ledger.reverted_commit(revert, self.repo.path), newest)
        self.assertIsNone(self.head_violation(revert))

    def test_a_git_failure_in_the_re_land_check_counts_as_a_re_land(self):
        self.assertIsNone(ship_ledger.forward_patch_ids(["src/lib/cards.ts"], tempfile.gettempdir()))
        self.assertTrue(ship_ledger.relands_a_commit("e" * 40, [], self.repo.path))
        with mock.patch.object(ship_ledger, "forward_patch_ids", return_value=None):
            self.assertTrue(ship_ledger.relands_a_commit("e" * 40, ["src/lib/cards.ts"], self.repo.path))

    def test_a_slow_history_read_times_out_closed(self):
        slow = subprocess.TimeoutExpired("git", ship_ledger.RELAND_TIMEOUT_SECONDS)
        with mock.patch.object(subprocess.Popen, "communicate", side_effect=slow):
            self.assertIsNone(ship_ledger.forward_patch_ids(["change.txt"], self.repo.path))
        self.assertLess(ship_ledger.RELAND_TIMEOUT_SECONDS, 60)

    def test_an_unanswered_block_still_refuses_an_exact_revert(self):
        landed = self.repo.commit_on_main("src/lib/cards.ts", "export const broken = 1;\n", "feat: cards")
        revert = self.repo.revert_branch("revert-cards", landed)
        self.repo.record(8, revert, "block", "engineering")
        self.assertIn("`engineering` block", self.head_violation(revert))


AWKWARD_CHARACTERS = (
    ("double quote", b'"', "middle"),
    ("backslash", b"\\", "middle"),
    ("tab", b"\t", "middle"),
    ("newline", b"\n", "middle"),
    ("leading space", b" ", "leading"),
    ("trailing space", b" ", "trailing"),
    ("leading colon", b":", "leading"),
    ("asterisk", b"*", "middle"),
    ("non-UTF-8 byte", b"\xff", "middle"),
)


def awkward_name(directory, character, position):
    stem, ext = b"x", b".js"
    if position == "leading":
        return directory + character + stem + ext
    if position == "trailing":
        return directory + stem + ext + character
    return directory + stem + character + b"y" + ext


class PlumbingRepo(Repo):
    def git_bytes(self, *args, stdin=None, index=None):
        env = test_env()
        if index is not None:
            env["GIT_INDEX_FILE"] = index
        return subprocess.run(
            ["git", *args], cwd=self.path, env=env, input=stdin, capture_output=True, check=True
        ).stdout.strip()

    def tree_of(self, commit):
        return self.git_bytes("rev-parse", commit + "^{tree}").decode()

    def tree_with(self, base_tree, path, content):
        index = os.path.join(self.path, ".git", "plumbing-index")
        self.git_bytes("read-tree", base_tree, index=index)
        if content is None:
            self.git_bytes("update-index", "--force-remove", "--", path, index=index)
        else:
            blob = self.git_bytes("hash-object", "-w", "--stdin", stdin=content).decode()
            self.git_bytes("update-index", "--add", "--cacheinfo", f"100644,{blob},".encode() + path, index=index)
        return self.git_bytes("write-tree", index=index).decode()

    def commit_tree(self, tree, parent, message):
        return self.git_bytes("commit-tree", tree, "-p", parent, "-m", message).decode()

    def land_on_main(self, tree, message):
        self.main = self.commit_tree(tree, self.main, message)
        self.git("update-ref", "refs/remotes/origin/main", self.main)
        return self.main


class AwkwardPathTest(unittest.TestCase):
    def setUp(self):
        self.repo = PlumbingRepo()
        self.addCleanup(self.repo.cleanup)

    def scenario(self, directory, character, position):
        path = awkward_name(directory, character, position)
        base_tree = self.repo.tree_of(self.repo.main)
        with_file = self.repo.tree_with(base_tree, path, b"exports.up = () => {};\n")
        return path, base_tree, with_file

    def test_changed_names_returns_each_path_byte_exact(self):
        for label, character, position in AWKWARD_CHARACTERS:
            path, base_tree, with_file = self.scenario(b"migrations/", character, position)
            head = self.repo.commit_tree(with_file, self.repo.main, "chore: add")
            self.assertEqual(
                [os.fsencode(name) for name in ship_ledger.changed_names(self.repo.main, head, self.repo.path)],
                [path],
                label,
            )

    def test_required_scopes_keep_security_and_migration_for_a_migration_path(self):
        for label, character, position in AWKWARD_CHARACTERS:
            _, _, with_file = self.scenario(b"migrations/", character, position)
            head = self.repo.commit_tree(with_file, self.repo.main, "chore: add")
            self.assertEqual(
                ship_ledger.required_scopes(head, self.repo.path), ("engineering", "security", "migration"), label
            )

    def test_an_exact_revert_of_a_migration_path_is_not_exempt(self):
        for label, character, position in AWKWARD_CHARACTERS:
            _, base_tree, with_file = self.scenario(b"migrations/", character, position)
            landed_tree = with_file
            self.repo.land_on_main(landed_tree, "feat: table " + label)
            revert = self.repo.commit_tree(base_tree, self.repo.main, "revert: table")
            self.assertIsNone(ship_ledger.reverted_commit(revert, self.repo.path), label)
            self.assertIn("no `engineering` pass", ship_ledger.head_violation("8", revert, self.repo.path), label)
            self.repo.land_on_main(base_tree, "chore: reset " + label)

    def test_a_re_land_of_an_awkward_path_is_detected(self):
        for label, character, position in AWKWARD_CHARACTERS:
            _, base_tree, with_file = self.scenario(b"", character, position)
            self.repo.land_on_main(with_file, "chore: surface " + label)
            self.repo.land_on_main(base_tree, "revert: surface " + label)
            re_land = self.repo.commit_tree(with_file, self.repo.main, "revert: revert surface")
            self.assertIsNone(ship_ledger.reverted_commit(re_land, self.repo.path), label)
            self.assertIn("no `engineering` pass", ship_ledger.head_violation("8", re_land, self.repo.path), label)

    def test_a_plain_exact_revert_of_an_awkward_path_is_still_exempt(self):
        for label, character, position in AWKWARD_CHARACTERS:
            _, base_tree, with_file = self.scenario(b"", character, position)
            landed = self.repo.land_on_main(with_file, "chore: newest " + label)
            revert = self.repo.commit_tree(base_tree, self.repo.main, "revert: newest")
            self.assertEqual(ship_ledger.reverted_commit(revert, self.repo.path), landed, label)
            self.repo.land_on_main(base_tree, "chore: reset " + label)


class SlowGitTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.cleanup)
        self.head = self.repo.commit("src/lib/cards.ts", "export const x = 1;\n", "chore: cards")
        fake_bin = tempfile.mkdtemp(prefix="slow-git-")
        self.addCleanup(shutil.rmtree, fake_bin, True)
        fake_git = os.path.join(fake_bin, "git")
        with open(fake_git, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\nexec sleep 30\n")
        os.chmod(fake_git, 0o755)
        self.slow_path = fake_bin + os.pathsep + os.environ.get("PATH", "")

    def test_the_whole_check_is_bounded_well_under_the_hook_timeout(self):
        self.assertLessEqual(ship_ledger.CHECK_BUDGET_SECONDS, 20)

    def test_a_slow_git_makes_the_re_land_scan_return_re_land_within_the_budget(self):
        with mock.patch.dict(os.environ, {"PATH": self.slow_path}), \
                mock.patch.object(ship_ledger, "CHECK_BUDGET_SECONDS", 2), \
                ship_ledger.check_budget(2):
            start = time.monotonic()
            self.assertTrue(ship_ledger.relands_a_commit("e" * 40, ["src/lib/cards.ts"], self.repo.path))
            self.assertLess(time.monotonic() - start, 4)

    def test_a_slow_git_makes_the_whole_check_refuse_within_the_budget(self):
        self.repo.passes(5, self.head, "engineering")
        with mock.patch.dict(os.environ, {"PATH": self.slow_path}), \
                mock.patch.object(ship_ledger, "CHECK_BUDGET_SECONDS", 2):
            start = time.monotonic()
            reason = ship_ledger.head_violation("5", self.head, self.repo.path)
            elapsed = time.monotonic() - start
        self.assertIsNotNone(reason)
        self.assertLess(elapsed, 4)


class DependabotTest(LedgerTestCase):
    def test_the_hook_reads_no_author_so_a_dependabot_marker_needs_a_ledger_pass_like_any_other(self):
        self.assertDenied(post(9, self.repo.marker_file(self.first)), "no `engineering` pass recorded for PR 9")
        self.repo.passes(9, self.first, "engineering")
        self.assertAllowed(post(9, self.repo.marker_file(self.first)))


class UnparsableLedgerTest(LedgerTestCase):
    def test_a_line_that_does_not_parse_denies_and_names_it(self):
        self.repo.passes(5, self.first, "engineering")
        with open(self.repo.ledger(), "a", encoding="utf-8") as ledger:
            ledger.write("2026-01-01T00:00:00Z\t5\tnot-a-sha\tblock\tengineering\t-\n")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "line 2 does not parse", "never delete a line")

    def test_an_unknown_scope_on_a_line_denies(self):
        with open(self.repo.ledger(), "w", encoding="utf-8") as ledger:
            ledger.write(f"2026-01-01T00:00:00Z\t5\t{self.first}\tblock\tux-voice\t-\n")
        self.repo.passes(5, self.first, "engineering")
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "line 1 does not parse")


class FailClosedTest(LedgerTestCase):
    def test_an_unreadable_ledger_denies(self):
        os.makedirs(self.repo.ledger())
        self.assertDenied(post(5, self.repo.marker_file(self.first)), "ledger hook failed")

    def test_a_failed_import_denies_with_the_refusal_shape(self):
        lonely = tempfile.mkdtemp(prefix="ship-ledger-hook-")
        self.addCleanup(shutil.rmtree, lonely, True)
        hook = os.path.join(lonely, "check-ship-review-ledger.py")
        shutil.copy(HOOK, hook)
        output = self.repo.run_hook(post(5, self.repo.marker_file(self.first)), hook=hook)
        self.assertEqual(decision(output), "deny")
        self.assertIn("ledger hook failed (ModuleNotFoundError)", reason(output))

    def test_input_that_does_not_decode_denies_with_exit_zero(self):
        for stdin_bytes in (b"\xff\xfe\xfa not utf-8", b"not json"):
            code, output = self.repo.run_hook_raw(stdin_bytes)
            self.assertEqual(code, 0)
            self.assertEqual(decision(output), "deny")
            self.assertIn("ledger hook failed", reason(output))

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
        for args in ((5, self.first[:7], "pass", "engineering"), (5, self.first, "ok", "engineering"),
                     ("x", self.first, "pass", "engineering"), (5, self.first, "pass", "ux-voice"),
                     (5, self.first, "pass", "mechanical-revert"), (5, self.first, "pass", "Security Review")):
            result = self.repo.record(*args)
            self.assertEqual(result.returncode, 2, args)
        self.assertFalse(os.path.exists(self.repo.ledger()))

    def test_normalises_the_scope_label(self):
        result = self.repo.record(5, self.first, "pass", "  Engineering ")
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(self.repo.ledger(), encoding="utf-8") as ledger:
            self.assertEqual(ledger.read().split("\t")[4], "engineering")

    def test_the_record_command_passes_the_merge_hooks(self):
        import merge_command

        command = f"python3 .claude/hooks/ship_ledger.py record 5 {self.first} block engineering"
        self.assertFalse(merge_command.is_gh_pr_merge(command))
        self.assertEqual(self.repo.run_hook(command), {"continue": True})


if __name__ == "__main__":
    unittest.main()
