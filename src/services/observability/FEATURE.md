# observability — instrumented HTTP + sink

The single egress point for every outbound third-party call (Notion, Anthropic, Dropbox, Google Drive, Patreon, Microsoft login, Apple login, Pexels, Wikimedia Commons). Adds SSRF defence, latency/error metrics, and a query API for the ops dashboard.

## Why this exists

Express controllers used to call `axios.get(...)` directly with user-controlled URLs. SonarCloud flagged repeated CWE-918 taint findings; we kept marking them false-positive. The fix was to give every call site one wrapper that:

1. Validates the URL is `https`, not a private/loopback host, and not an IPv4-mapped IPv6 address.
2. Resolves the host once via `dns.promises.lookup`, refuses any private IP in the answer set, and pins the resolved address through `axios`'s `lookup` option so the connection cannot be re-targeted at request time.
3. Records latency, status, and error class into `ObservabilitySink` so `OpsController` can render service health without scraping logs.
4. Sets `maxRedirects: 0` and follows redirects itself, re-running the full validation (scheme + private-host + allowlist + DNS pin) on every hop up to `MAX_REDIRECTS`. An allowlisted origin that 302s to a private/internal host or an off-allowlist host is rejected on the hop, not followed. A 3xx arrives either as a resolved response or — under axios's default `validateStatus` — as a rejected error carrying `error.response`; both paths read the `Location` header and re-validate. A hop whose host differs from the ORIGINAL request's host is re-issued without credentials: `stripAuthForCrossHostHop` drops `config.auth` (Basic) and any `Authorization` header, keeping other headers — the follow-redirects cross-host credential drop, load-bearing for services with a `null` host allowlist (`notion`, `dropbox`, `mcp`) where a malicious redirect would otherwise carry the caller's client secret or bearer token to an arbitrary HTTPS host (found in the 2026-08-21 OAuth-retry security review; pre-existing, fixed then). Same-host hops keep credentials.

## Public surface

- `instrumentedAxios(service, config)` — drop-in replacement for `axios(...)`. `service` must be one of `OBSERVABILITY_SERVICES`.
- `OBSERVABILITY_SERVICES` — frozen list. Adding a new outbound integration means **adding it here first**, then writing the wrapper.
- `FIXED_HOST_ALLOWLIST` — per-service exact-host pin. Set to `null` for services that need wildcard hosts (e.g. Notion's per-tenant CDNs, or `mcp` — the hosted MCP `convert_to_deck` tool fetches an arbitrary user-supplied URL, so it needs wildcard hosts and relies on the private-IP/DNS-pinning SSRF guard); set to an explicit list for services that only ever talk to one or two endpoints.
- `DOMAIN_SUFFIX_ALLOWLIST` — per-service domain-suffix pin for services whose content hosts vary by subdomain but share a registrable domain. `dropbox` is pinned to `dropboxusercontent.com` (the Chooser's `linkType: 'direct'` links resolve to `*.dl.dropboxusercontent.com`); this is what stops the upload route from being an arbitrary-public-host GET. A suffix entry takes precedence over the service's `FIXED_HOST_ALLOWLIST` row.
- `getObservabilitySink()` / `ObservabilitySinkInstance` — singleton sink. The query service (`ObservabilityQueryService`) reads from it.
- `ObservabilityQueryService.getMetrics(window)` — read API for `/ops`. Aggregates inbound volume + route latency, outbound volume + per-service latency percentiles (p50/p95/p99), and route/service error rates over a `1h | 24h | 7d` window. Adding a new aggregation means extending `IObservabilityRepository`, the `OpsMetricsResponse` shape, and the engineering tab in one PR. The service also takes an optional `IUnsupportedNotionBlockRepository` (2nd constructor arg) and includes `unsupported_blocks` (all-time aggregate of dropped Notion block types, ordered by occurrences) in the response — this list is window-independent (it reflects lifetime totals, not the selected window). It likewise takes optional `IConversionOutputStatsRepository` (3rd) and `IParsePathSignatureRepository` (4th) args and adds two more window-independent all-time aggregates: `conversion_output` (per-source `decks`/`cards`/`empty_back_cards`, so a silent empty-back regression like the nested-toggle incident shows up as fleet signal instead of a support email) and `parse_path_signatures` (per-conversion parse outcome, `recognized` vs `unclassified`, so a structure the parser stops recognising surfaces early). Both counters are written fire-and-forget on the upload path (`UploadService`); `conversion_output` is also written on the Notion convert path (`performConversion`, source `convert`).

## Metric tripwire

A daily check that compares yesterday's user-outcome rates (UTC) with the seven days before and emails ops (`sendAiSpendAlertEmail` to `SUPPORT_CC_ADDRESS`) when one drops. It exists because a silent regression ran for weeks before anyone read the numbers: #4589 removed the held-back notice for signed-in free users over the card limit, and buying fell for 19 days until #4789. Replayed over that window, the signed-in partial metric fires on the day #4589 merged.

- **Metrics** live in `src/lib/observability/tripwire/tripwireMetrics.ts`, a closed set. Each one names its source event and what one row means. All read `events`: conversion success, decks with 3 or more cards, download after a successful conversion, upload after an upload-page view, and the over-limit notice shown to signed-in and to anonymous uploaders. The follow-through metrics count person-days (user id, else anonymous id) and pair events on the same UTC day. SQL is in `src/data_layer/MetricTripwireRepository.ts`, and its generated-SQL test sits beside it.
- **Power gate** (`evaluateRateDrop.ts`): a metric alerts only when yesterday has at least 5 rows, the baseline has at least 30, the drop is at least the metric's `minRelativeDrop`, and the exact binomial chance of a count that low at the baseline rate is under 0.001. Low volume stays quiet. A total collapse still fires on a handful of rows.
- **Not covered:** raw per-surface counts. They swing with traffic and campaigns, so a fixed threshold either misses or pages on a quiet Sunday. Purchase within 7 days of a partial is also left out: it needs a week to mature and has too few buyers a day to power. The notice-shown rate catches the same regression on day 1.
- **Scheduling and dedup:** `scheduleMetricTripwire` runs on boot when overdue, then every 6 hours under advisory lock `JOB_LOCK_KEYS.metricTripwire` with the exclusive-batch `lastRunAt` re-check (`metric_tripwire_checked` events). Two blue-green colors cannot both run it. An alert writes a `metric_tripwire_alert_sent` event `{metric, day}` once the email sends. Every later run skips that metric for that day, so each metric emails at most once per day. A failed send records nothing, and the next run retries.
- **Reading it:** each run logs `[metric-tripwire] day=… metric=… verdict=…` per metric to the pm2 out log. A regression that persists stops alerting once it has rolled into the 7-day baseline.

## Adding a new service

1. Append the service name to `OBSERVABILITY_SERVICES`.
2. Decide host policy: tight allowlist if you can name the hosts; `null` only if you can justify it.
3. Replace the call site with `instrumentedAxios('<name>', { url, ... })`. **Do not** import `axios` directly elsewhere.
4. Cover with a test that asserts (a) a private-IP host is rejected and (b) the success path records a sink event.

## Things to know before editing

- The DNS pin is what stops a TOCTOU SSRF (validate hostname → connect happens later → DNS answer changed). Don't "simplify" it back to axios's default lookup.
- The IPv4-mapped IPv6 rejection (`::ffff:127.0.0.1`) was a real bypass — keep both the textual check and the resolved-IP check.
- SonarCloud has historical taint findings on this file marked false-positive via the API (dispositions live in the SonarCloud UI; the waiver context lives beside the `tssecurity` FP notes in `sonar-project.properties`). If a new taint warning shows up here, audit before silencing.
- This file is the only file where `axios` may be imported.
- `request_logs` and `outbound_call_logs` are insert-only and unbounded. `IObservabilityRepository.deleteOlderThan(days)` prunes rows past the retention window; `src/lib/observability/jobs/scheduleObservabilityCleanup.ts` runs it daily on startup (`OBSERVABILITY_RETENTION_DAYS = 30`). Both tables index `created_at`, so the prune uses the index. Adjust the window by editing the constant, not by adding an env flag.
