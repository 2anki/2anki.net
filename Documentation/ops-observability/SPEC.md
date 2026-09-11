# Spec: Internal Ops Observability (`/ops`)

**Outcome**: Al opens `/ops` and within 5 seconds knows: are requests slow, which endpoints/services are slowest, are errors spiking, and how often we hit Claude/Notion. All inbound requests and outbound external API calls are persisted in Postgres with method, path/service, status, and duration. Zero visibility becomes "open dashboard, see truth."

**Goal alignment**: Being the go-to place for fast, beautiful flashcards means knowing what breaks and what's slow before users tell us. This is the foundation that lets every later perf/reliability bet be data-driven instead of vibes-driven. Critical constraint: this feature is internal — it must NOT degrade user-facing latency. Mitigation: writes are fire-and-forget (`void persist().catch(log)`), batched via an in-memory queue flushed every 5s or 100 rows (whichever first), and the middleware itself only captures timestamps + finalizes on `res.on('finish')` — no blocking work in the request path.

## Scope (what we ARE building)

- **Inbound middleware** `requestLoggingMiddleware` mounted globally in `createServer.ts` before routers. Captures `method`, `path` (route template, not raw URL), `status_code`, `duration_ms`, `created_at`. Skips `/ops/*` itself.
- **Outbound wrapper** `services/observability/instrumentedAxios.ts` — thin `axios` wrapper exposing `get/post/put/delete` that records `service` (caller-supplied label: `"notion"`, `"claude"`, `"dropbox"`, `"google_drive"`, `"patreon"`), `endpoint` (host + pathname, query stripped), `status_code`, `duration_ms`, `created_at`. Migrate the 8 known callers (NotionService, AuthenticationService, downloadMediaOrSkip, renderIcon, useMetadata, handleDropbox, handleGoogleDrive, future Claude calls) to use it. Opt-in only — no global monkeypatch.
- **Persistence**: two tables (see Data Model). Writes go through `services/observability/ObservabilitySink.ts` which buffers and flushes via a `data_layer/ObservabilityRepository` batch insert.
- **Layered read path** for `/ops`: `routes/OpsRouter.ts` → `controllers/OpsController.ts` → `usecases/GetOpsMetrics.ts` → `services/ObservabilityQueryService.ts` → `data_layer/ObservabilityRepository.ts`. Returns aggregated JSON; the React page renders Recharts client-side.
- **`/ops` page** (React, served from existing frontend bundle): four Recharts charts (see Charts).
- **Auth guard** `RequireOpsAccess` middleware (see Auth Guard).
- **Navbar entry** "Ops" — rendered only when frontend sees `featureFlags.ops === true` (set in `UsersControllers.getMe` when `email === ANKIFY_ALLOWLIST_EMAILS[0]`).

## Out of scope (NOT building)

- Alerting / paging / Slack hooks
- Distributed tracing, spans, parent/child correlation
- Log aggregation (text logs stay in stdout / journalctl)
- Anything user-facing — no per-user dashboards, no public status page
- Retention / rotation jobs — we'll add a cron later once we see real volume
- Prometheus, OpenTelemetry, Datadog, Sentry integration
- Capturing request/response bodies, headers, or payload sizes
- Per-user breakdowns (we don't store `owner` in observability tables — see Privacy)

## Data model

Two tables, migration `migrations/20260510000000_observability.js`. Both Kanel-regenerated after migrate.

**`request_logs`**

| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| method | varchar(8) | GET/POST/etc |
| route | text | Express route template e.g. `/api/upload/:id`, never raw URL |
| status_code | smallint | |
| duration_ms | integer | |
| created_at | timestamptz | default `now()` |

Indexes: `(created_at desc)`, `(route, created_at desc)`.

**`outbound_call_logs`**

| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| service | varchar(32) | allowlist: `notion`, `claude`, `dropbox`, `google_drive`, `patreon` |
| endpoint | text | `host + pathname`, query stripped |
| status_code | smallint | nullable (network error → null) |
| duration_ms | integer | |
| created_at | timestamptz | default `now()` |

Indexes: `(created_at desc)`, `(service, created_at desc)`.

We explicitly do NOT store: request bodies, response bodies, headers, query strings, full URLs, user IDs, IP addresses, user-agents, error stacks, tokens.

## Instrumentation approach

- **Inbound**: single Express middleware. Records `start = Date.now()` then `res.on('finish', () => sink.recordRequest({...}))`. Uses `req.route?.path ?? req.path` so we don't blow cardinality on dynamic IDs. Mounted once in `createServer.ts` after `cookie-parser` and before all routers; explicitly excludes `/ops`.
- **Outbound**: opt-in wrapper. Callers change `axios.get(url, opts)` → `instrumentedAxios.get('notion', url, opts)`. Wrapper measures duration, strips query string from URL before logging, catches errors to record `status_code = err.response?.status ?? null` then rethrows — never swallows.
- **Sink**: in-memory array with `setInterval(flush, 5000)` and threshold-based flush at 100 rows. Single batch insert per table via Knex. On shutdown, flush once. If insert fails, log to stderr and drop — never block requests.

## Privacy / safety

- No PII, no auth tokens, no cookies, no bodies.
- URLs: outbound wrapper does `new URL(url); return u.host + u.pathname` — query stripped before persistence.
- Inbound `route` is the Express template (e.g. `/upload/:id`), not the raw path with the actual ID. If `req.route` is undefined (404s), store the literal string `"unmatched"` rather than the raw URL.
- Service names are an allowlist enum in code; unknown services rejected at wrapper boundary.

## Charts on `/ops`

Default window: **last 24h**, with a dropdown for 1h / 24h / 7d. All charts read from one aggregated endpoint `GET /ops/api/metrics?window=24h`.

1. **Inbound call volume over time** — Recharts `AreaChart`, x = 5-minute buckets, y = request count, stacked by status class (2xx/3xx/4xx/5xx).
2. **Latency by route** — Recharts `BarChart`, top 15 routes by request count, two bars per route: avg and p95 ms.
3. **Outbound call volume by service** — Recharts `LineChart`, x = hourly buckets, one line per service.
4. **Error rate by route and by service** — Recharts `BarChart`, two side-by-side panels, percentage of non-2xx requests for top 10 routes and top 5 services.

No drill-down, no per-row table view in v1. If Al needs a row view later, we add it.

## Auth guard

```
routes/OpsRouter.ts:
  router.use(configureUserLocal);   // already populates res.locals.email
  router.use(RequireOpsAccess);     // new — see below
  router.get('/api/metrics', controller.getMetrics);
  router.get('*', controller.serveDashboardHtml);
```

`RequireOpsAccess` (new, mirrors `RequireAnkifyAccess` but locked to a single email):

```
if (res.locals.email?.toLowerCase() !== 'alexander@alemayhu.com') {
  return res.status(404).end();   // 404, not 403 — don't reveal existence
}
return next();
```

Frontend navbar reads `featureFlags.ops` from `/api/users/me`; same email check is applied server-side inside `getMe`.

## Risks & open questions

1. **Recharts isn't in `package.json` yet** — adds ~90KB gzipped. Acceptable since it's lazy-loaded only on `/ops`, but confirm before installing. Alternative: a tiny inline SVG renderer, but not worth the time.
2. **Cardinality on `route`** — if any router uses `app.use('/x', handler)` without param names, we'll get raw paths. Audit existing routers when wiring middleware; fall back to `"unmatched"` for misses.
3. **Volume estimate unknown** — at current traffic (~?? rpm) batch-insert every 5s is fine. If we spike past ~50 rps sustained, we'll need a proper queue (e.g. write to a file and ingest, or move to a separate table partition). Revisit after one week of data.

## Blocker question for Al

We have no current rps baseline in the repo. **Roughly how many requests/min does 2anki.net handle at peak right now?** If it's <10 rps the design above is fine; if it's >100 rps sustained I'd swap the in-process buffer for a `pg_notify`-based fan-out or a simple newline-delimited file tailed by a separate ingester, and that changes the implementation enough that I'd want to know upfront.
