# observability — instrumented HTTP + sink

The single egress point for every outbound third-party call (Notion, Anthropic, Dropbox, Google Drive, Patreon, Microsoft login, Apple login, Pexels, Wikimedia Commons). Adds SSRF defence, latency/error metrics, and a query API for the ops dashboard.

## Why this exists

Express controllers used to call `axios.get(...)` directly with user-controlled URLs. SonarCloud flagged repeated CWE-918 taint findings; we kept marking them false-positive. The fix was to give every call site one wrapper that:

1. Validates the URL is `https`, not a private/loopback host, and not an IPv4-mapped IPv6 address.
2. Resolves the host once via `dns.promises.lookup`, refuses any private IP in the answer set, and pins the resolved address through `axios`'s `lookup` option so the connection cannot be re-targeted at request time.
3. Records latency, status, and error class into `ObservabilitySink` so `OpsController` can render service health without scraping logs.
4. Sets `maxRedirects: 0` and follows redirects itself, re-running the full validation (scheme + private-host + allowlist + DNS pin) on every hop up to `MAX_REDIRECTS`. An allowlisted origin that 302s to a private/internal host or an off-allowlist host is rejected on the hop, not followed. A 3xx arrives either as a resolved response or — under axios's default `validateStatus` — as a rejected error carrying `error.response`; both paths read the `Location` header and re-validate.

## Public surface

- `instrumentedAxios(service, config)` — drop-in replacement for `axios(...)`. `service` must be one of `OBSERVABILITY_SERVICES`.
- `OBSERVABILITY_SERVICES` — frozen list. Adding a new outbound integration means **adding it here first**, then writing the wrapper.
- `FIXED_HOST_ALLOWLIST` — per-service exact-host pin. Set to `null` for services that need wildcard hosts (e.g. Notion's per-tenant CDNs, or `mcp` — the hosted MCP `convert_to_deck` tool fetches an arbitrary user-supplied URL, so it needs wildcard hosts and relies on the private-IP/DNS-pinning SSRF guard); set to an explicit list for services that only ever talk to one or two endpoints.
- `DOMAIN_SUFFIX_ALLOWLIST` — per-service domain-suffix pin for services whose content hosts vary by subdomain but share a registrable domain. `dropbox` is pinned to `dropboxusercontent.com` (the Chooser's `linkType: 'direct'` links resolve to `*.dl.dropboxusercontent.com`); this is what stops the upload route from being an arbitrary-public-host GET. A suffix entry takes precedence over the service's `FIXED_HOST_ALLOWLIST` row.
- `getObservabilitySink()` / `ObservabilitySinkInstance` — singleton sink. The query service (`ObservabilityQueryService`) reads from it.
- `ObservabilityQueryService.getMetrics(window)` — read API for `/ops`. Aggregates inbound volume + route latency, outbound volume + per-service latency percentiles (p50/p95/p99), and route/service error rates over a `1h | 24h | 7d` window. Adding a new aggregation means extending `IObservabilityRepository`, the `OpsMetricsResponse` shape, and the engineering tab in one PR. The service also takes an optional `IUnsupportedNotionBlockRepository` (2nd constructor arg) and includes `unsupported_blocks` (all-time aggregate of dropped Notion block types, ordered by occurrences) in the response — this list is window-independent (it reflects lifetime totals, not the selected window). It likewise takes optional `IConversionOutputStatsRepository` (3rd) and `IParsePathSignatureRepository` (4th) args and adds two more window-independent all-time aggregates: `conversion_output` (per-source `decks`/`cards`/`empty_back_cards`, so a silent empty-back regression like the nested-toggle incident shows up as fleet signal instead of a support email) and `parse_path_signatures` (per-conversion parse outcome, `recognized` vs `unclassified`, so a structure the parser stops recognising surfaces early). Both counters are written fire-and-forget on the upload path (`UploadService`); `conversion_output` is also written on the Notion convert path (`performConversion`, source `convert`).

## Adding a new service

1. Append the service name to `OBSERVABILITY_SERVICES`.
2. Decide host policy: tight allowlist if you can name the hosts; `null` only if you can justify it.
3. Replace the call site with `instrumentedAxios('<name>', { url, ... })`. **Do not** import `axios` directly elsewhere.
4. Cover with a test that asserts (a) a private-IP host is rejected and (b) the success path records a sink event.

## Things to know before editing

- The DNS pin is what stops a TOCTOU SSRF (validate hostname → connect happens later → DNS answer changed). Don't "simplify" it back to axios's default lookup.
- The IPv4-mapped IPv6 rejection (`::ffff:127.0.0.1`) was a real bypass — keep both the textual check and the resolved-IP check.
- SonarCloud has historical taint findings on this file marked false-positive via the API (dispositions live in the SonarCloud UI; the waiver context is documented beside the `tssecurity` FP notes in `sonar-project.properties` and `.claude/rules/sonar.md`). If a new taint warning shows up here, audit before silencing.
- This file is the only file where `axios` may be imported.
- `request_logs` and `outbound_call_logs` are insert-only and unbounded. `IObservabilityRepository.deleteOlderThan(days)` prunes rows past the retention window; `src/lib/observability/jobs/scheduleObservabilityCleanup.ts` runs it daily on startup (`OBSERVABILITY_RETENTION_DAYS = 30`). Both tables index `created_at`, so the prune uses the index. Adjust the window by editing the constant, not by adding an env flag.
