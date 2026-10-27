# Dated follow-ups and owner steps go in the private project

Two kinds of follow-up are **draft items in the private Lær Smart Follow-ups project** (https://github.com/orgs/Laer-Smart/projects/4), never issues in `2anki/server`:

- **Reads**: adoption reviews, T+30 keep-or-remove reads, "Read (by <date>)" metric checks, Search Console reads, the day-1 and day-2 spend reads after a model swap (`.claude/docs/prod-ops.md`), and any other dated look-it-up check.
- **Owner steps**: anything only Alexander can do (a prod secret, a Stripe, Google or App Store dashboard setting, a directory submission, a decision). These used to be `Needs you` issues. Still ask him in the chat as `/ship` says; the item is what keeps the step from being lost once the chat ends.

Why: the repo is public. Reads carry business numbers, baselines, funnel rates and keep/kill reasoning, and "Memory & sensitive data" in `CLAUDE.md` keeps those out of the repo. Both kinds also crowded the issue list: on 2026-10-27, 18 of 33 open issues were reads or owner steps, not work, and all were moved to the project.

Real work (a bug, a feature, a code change a read decided on) still gets a GitHub issue. A read that ends in "remove" or "fix" files a GitHub issue for that work, without the private numbers.

`.claude/rules/support-confidentiality.md` still applies inside the project: numeric user IDs only, no reporter names, emails, filenames or deck titles. A private project can be shared or made public later.

## Fields

Every item sets Status, Area, Owner and, when there is a date, Due:

| Field | Value |
| --- | --- |
| Status | `Todo`; `Done` once the read is taken and its verdict acted on, or the owner step is done |
| Area | the surface it is about: `2anki web`, `2anki app`, `Google Ads`, `Distribution`, `Other apps`, `TubeHabit`, `Company` |
| Owner | `Claude` for a read an agent can run, `Alexander` for an owner step |
| Due | the read date or the external deadline |

Put the read date in the title too (`Adoption review (by 2026-11-24): <surface>, keep or remove`) so the board sorts at a glance. An adoption review's body states the three things the `CLAUDE.md` "Surface lifecycle" section requires: the reachable population and its query, a power check on any support or email condition, and whether the usage event can see passive use. Reference PRs and issues with full URLs; a bare `#NNNN` does not link from an org project.

## Recipe

```bash
P=PVT_kwDOC1YeNs4Bo_mp
ID=$(gh project item-create 4 --owner Laer-Smart --title "<title>" --body "<body>" --format json --jq .id)
gh project item-edit --project-id $P --id $ID --field-id PVTSSF_lADOC1YeNs4Bo_mpzhndKnE --single-select-option-id <status-option-id>
gh project item-edit --project-id $P --id $ID --field-id PVTSSF_lADOC1YeNs4Bo_mpzhndKqU --single-select-option-id <area-option-id>
gh project item-edit --project-id $P --id $ID --field-id PVTSSF_lADOC1YeNs4Bo_mpzhndKqk --single-select-option-id <owner-option-id>
gh project item-edit --project-id $P --id $ID --field-id PVTF_lADOC1YeNs4Bo_mpzhndKqo --date <YYYY-MM-DD>
```

| Field | Option IDs |
| --- | --- |
| Status | `Todo` `f75ad846`, `In Progress` `47fc9ee4`, `Done` `98236657` |
| Area | `2anki web` `16001be3`, `2anki app` `75390195`, `Google Ads` `00b69850`, `Distribution` `fb0de01b`, `Other apps` `e91364de`, `TubeHabit` `fdc7f46c`, `Company` `ac903c5f` |
| Owner | `Alexander` `b8f8f72c`, `Claude` `f01b09b7`, `Other agent` `ccb60974` |

If an ID stops matching, re-read them with `gh project field-list 4 --owner Laer-Smart --format json`.

To find what is due: `gh project item-list 4 --owner Laer-Smart --limit 200 --format json --jq '.items[] | select(.status=="Todo" and .due != null) | "\(.due)\t\(.title)"' | sort`.

The token needs the `project` scope (`gh auth refresh -s project` if a write is refused).
