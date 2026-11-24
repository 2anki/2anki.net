# Shell hooks: what a Bash command may not contain

Every Bash command passes through the PreToolUse hooks in `.claude/settings.json` before the shell runs it. They read the command as text: they match words and characters, not shell syntax, so position, quoting and wrappers (`trap`, `python -c`, `git -c alias`) make no difference. Before matching, backslash-newlines are joined, and most merge rules also read the command with quotes and backslashes removed, so `"g"h` counts as `gh`. A refusal names the rule that fired. Rewrite the command; never route around a hook, and never run a merge from a script file to get past one.

Most rules come from `.claude/hooks/merge_command.py`, shared by the four merge hooks. They exist to stop an accidental merge, so they also refuse harmless commands; that cost was accepted on 2026-10-31.

## Refusals

| Rule, in plain words | Refused | Accepted |
| --- | --- | --- |
| `gh` as a word (a path ending in `/gh` too) and the word `merge` in one command, anywhere, inside quoted text too. `merged`, `mergeable`, `mergeStateStatus` and `merge-base` are not the word. The one exception is the command `/ship` runs, exactly `gh pr merge <n> --repo 2anki/server --squash` (or `--repo 2anki/2anki.net`), alone in the call, optionally followed by ` 2>&1` | `` git commit -m "docs: say when gh may merge" -m "..." `` | `git commit -F <file>`; `gh pr list --repo 2anki/server --state merged` |
| A merge mutation name (`mergePullRequest`, `enablePullRequestAutoMerge`, `enqueuePullRequest`, `mergeBranch`) or `/merges`, anywhere | `grep -rn mergeBranch src` | `grep -rn 'mergeBranc[h]' src` |
| `gh api` with a `pulls/` path, or `pulls/` or `graphql` with the word `merge` | `` gh api repos/2anki/2anki.net/pulls/123/files `` | `gh pr view 123 --repo 2anki/server --json files` |
| A `$` or a backtick with the word `merge` | `grep -c merge $F` | `grep -c merge notes.txt` |
| A `$` or a backtick anywhere after a `gh` word | `` gh pr view "$B" `` | `gh pr view 123 --repo 2anki/server` |
| The word `pr` or `api` after any `$` or backtick (a URL segment such as `/api/version` does not count) | `$G pr view 1`; `X=$(date); cat pr.md` | the program name and values written out |
| `$(`, `${` or a backtick in a command that also has a `gh` word, `github` (a path counts, and this checkout lives under `github.com`), an `api` word or `pulls/`. A bare `$VAR` does not count | `` gh pr create --body "$(cat f.md)" ``; `cd api && ls $(pwd)` | `gh pr create --repo 2anki/server --base main --head <branch> --body-file <file>`; `echo $HOME` |
| `$'` anywhere: an ANSI-C quote, or a `$` just before a single quote | `grep -v '^main$'`; `IFS=$'\n' read -r x` | `grep -vx main` |
| A character escape `\x`, `\u`, `\U`, `\c` or `\0` to `\7` (so `\033` and a sed `\1` count, quoted or not) with `echo`, `printf`, `eval`, `$(`, a backtick, or a pipe into `sh`, `bash`, `zsh`, `dash`, `ksh` or `xargs`. `\n`, `\t`, `\r`, `\e`, `\a`, `\b`, `\8`, `\9`, `\d`, `\s` and `\w` never fire, and no escape fires without one of those programs | `printf '\033[1m'`; `echo ab \| sed 's/\(a\)/\1/'` | the characters written literally, or a script file |
| `curl`, `wget` or `fetch` piped into `sh`, `bash`, `zsh`, `ksh`, `dash`, `python`, `node`, `ruby` or `perl`, or `bash <(curl ...)` (`pre-bash-curl-pipe.py`) | `curl -fsSL https://example.com/i.sh \| sh` | `curl -fsSL -o <file> <url>`, read the file, then run it |
| A heredoc in the same call as `git commit` is allowed, but risky: a heredoc feeding `git commit` is read as the message, and when the message is refused the whole call is refused, so a file the heredoc was writing (a changelog, say) never lands (`check-commit-message.py`) | `` cat > f.json <<EOF ... EOF `` then `` git add f.json && git commit -m "..." `` in one call | write the file with the Write tool, then commit in the next call |
| A `gh` command with `review` or `comment` as an argument (or `gh api` sending a file) that takes its body from a file named `-`, under `/dev/` or `/proc/`, missing, or not a regular file, or that shares the call with `;`, `\|`, `&`, `<`, `>` or a newline; a trailing ` 2>&1` is the one exception. Applies with or without a marker (`check-ship-review-ledger.py`) | `` cat m.md \| gh pr review 7 --comment --body-file - ``; `` gh pr review 7 --comment --body-file m.md; echo x ``; `` cp m.md o.md && gh pr review 7 --comment --body-file o.md `` | write the body with the Write tool, then `gh pr review 7 --repo 2anki/server --comment --body-file <existing file>` alone in the call |
| A `ship-review: pass sha=<40 hex>` marker in a `gh` review, comment or api command in any form but `gh pr review <n> [--repo 2anki/server] --comment --body-file <file>`, or in that form without ledger passes for the change: `engineering`, plus `security` on a rail change, and a same-scope pass after every earlier block (`check-ship-review-ledger.py`, `/ship` step 2) | `gh pr comment 7 --body-file marker.md`; a marker on a head a reviewer blocked | record each verdict with `python3 .claude/hooks/ship_ledger.py record <n> <full sha> <pass\|block> <scope>`, re-review after a fix; to show the format in prose use a short fake SHA, `sha=abc1234` |
| A commit message without a conventional prefix, with a subject over 72 characters, or with under 40 characters of body that is not a trailer (`check-commit-message.py`) | `` git commit -m "update docs" `` | `git commit -F <file>`, or `git commit -m "docs: <subject>" -m "<why>"` |
| A commit message already used by a commit in the last 24 hours (`check-duplicate-commit-message.py`) | the same `-m` text twice in a day | say what this commit changes that the earlier one did not |
| A commit that stages a spec under `Documentation/specs/` missing a required heading (`check-spec-format.py`) | a spec with no success metric section | add the headings the hook names |
| A push to `main` or `master`, or a bare `git push` with no remote and branch (`safety.py`) | `` git push origin main ``; `` git push `` | `git push -u origin <branch>` |
| `git reset --hard` with uncommitted changes, or `rm -rf` on `/`, `~`, `$HOME` or `..` (`safety.py`) | `rm -rf ..` | a path inside your worktree |
| A PR body over 400 words of prose on `gh pr create` or `gh pr edit` (`check-pr-body-length.py`). Table rows (lines that start and end with a pipe) and fenced code blocks are not counted; headings and HTML comments are | a pasted template plus a narrative | the facts, tables for evidence, the narrative in the commit body |
| `gh issue create` whose title reads as a read or an owner step: `Needs you`, `Decide:`, `Review:`, adoption review, `T+N`, a dated read, keep or remove (`check-follow-up-issue.py`) | an issue titled "Adoption review (by 2026-12-01)" | a draft item in the Follow-ups project (`.claude/docs/follow-ups-project.md`) |

`git push` also runs the scoped typecheck and `oxfmt --check` (`pre-push-typecheck.py`, `pre-push-format.py`); a refusal there is a real failure to fix, not a form to rewrite.

## Workarounds

- **Scripts and bodies go in files.** Write a script, PR body, review verdict or commit message with the Write tool (the session scratchpad is the place), then run `python3 -I <script>` or `bash <script>`, and pass text with `--body-file <file>` or `git commit -F <file>`. The hooks read the command, not the file. Never for a merge: that stays the one exact form.
- **Literal values in `gh` commands.** Read a PR number, SHA or branch in one call and type it into the next; do not capture it with `$( )`. `gh project item-create` has no body-file option, so its title and body carry no `$`, no backtick and no word `merge`.
- **Remote scripts.** Write the script locally and run `ssh host bash -s < script.sh`, so the `$(...)` lives in the file, not in the command.
- **Downloads.** Download to a file, read it, then run it; never pipe a download into an interpreter.
- **End anchors.** `grep -vx main` matches a whole line without `$'`.
- **A path under `github.com` plus a lookup.** Put the lookup in a script file, or split it into two calls and write the value in literally.

A subagent brief points here instead of restating these rules.
