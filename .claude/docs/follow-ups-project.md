# Dated follow-ups go in the private project

Adoption reviews, T+30 keep-or-remove reads, "Read (by <date>)" metric checks, Search Console reads and any other dated look-it-up follow-up are **draft items in the private Lær Smart Follow-ups project** (https://github.com/orgs/Laer-Smart/projects/4), never issues in `2anki/server`.

Why: the repo is public. These items carry business numbers, baselines, funnel rates and keep/kill reasoning, which `CLAUDE.md` ("Memory & sensitive data") says never belong in a public artifact. They also crowded the issue list: on 2026-10-27, 15 of 33 open issues were reviews, not work, and were moved here.

Real work (a bug, a feature, a code change a review decided on) still gets a GitHub issue. A review that ends in "remove" or "fix" files that issue then, without the private numbers.

## Fields

Every item sets all four:

| Field | Value |
| --- | --- |
| Status | `Todo` (`Done` once read and the verdict acted on) |
| Area | `2anki web`, `Google Ads`, `Distribution`, … — the surface it measures |
| Owner | `Claude` for a read an agent can run, `Alexander` for a dashboard or account only he holds |
| Due | the read date |

Put the read date in the title too (`Adoption review (by 2026-11-24): <surface>, keep or remove`) so the board sorts at a glance. The body states the reachable population, the query, the threshold and the guard the `CLAUDE.md` "Surface lifecycle" section requires. Reference PRs and issues with full URLs; a bare `#NNNN` does not link from an org project.

## Recipe

```bash
P=PVT_kwDOC1YeNs4Bo_mp
ID=$(gh project item-create 4 --owner Laer-Smart --title "<title>" --body "<body>" --format json --jq .id)
gh project item-edit --project-id $P --id $ID --field-id PVTSSF_lADOC1YeNs4Bo_mpzhndKnE --single-select-option-id f75ad846   # Status: Todo
gh project item-edit --project-id $P --id $ID --field-id PVTSSF_lADOC1YeNs4Bo_mpzhndKqU --single-select-option-id 16001be3   # Area: 2anki web
gh project item-edit --project-id $P --id $ID --field-id PVTSSF_lADOC1YeNs4Bo_mpzhndKqk --single-select-option-id f01b09b7   # Owner: Claude
gh project item-edit --project-id $P --id $ID --field-id PVTF_lADOC1YeNs4Bo_mpzhndKqo --date 2026-11-24                      # Due
```

Other option IDs (`gh project field-list 4 --owner Laer-Smart --format json`): Area `Google Ads` `00b69850`, `Distribution` `fb0de01b`, `2anki app` `75390195`; Owner `Alexander` `b8f8f72c`; Status `Done` `98236657`.

To find what is due: `gh project item-list 4 --owner Laer-Smart --limit 200 --format json --jq '.items[] | select(.status=="Todo" and .due != null) | "\(.due)\t\(.title)"' | sort`.

The token needs the `project` scope (`gh auth refresh -s project` if a write is refused).
