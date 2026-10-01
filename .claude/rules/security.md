# Security rules

Stack-specific risks for an Express/TypeScript + Knex + multer + Notion/Claude/Stripe surface. Each row maps a recurring foot-gun to the safe pattern and the CWE it falls under.

| Requirement | Do instead | CWE |
| --- | --- | --- |
| Never use `knex.raw()` with string concatenation or template-string interpolation of user input. | Pass bindings: `knex.raw('select * from t where id = ?', [id])` or use the query builder. | CWE-89 |
| Never use `!value` to test "is the ID present?". Falsy IDs (`0`, `""`) get rejected. | Use `value == null` (covers `null` and `undefined`) at the boundary. | CWE-754 |
| Do not interpolate user input into `child_process.exec`, `spawn(... , { shell: true })`, or template strings passed to a shell. | Pass argv as an array with `shell: false`; validate against an allowlist. | CWE-78 |
| Do not pass user-controlled URLs to `axios`/`fetch` without going through `instrumentedAxios` SSRF guard. | Use `services/observability/instrumentedAxios.ts`; preserve the DNS-pinned host check and IPv4-mapped IPv6 rejection. | CWE-918 |
| Do not log `password`, `token`, `cookie`, Notion API keys, Stripe customer IDs, JWT payloads, session IDs, or webhook secrets. | Log a hashed surrogate (see `lib/misc/hashToken`) or omit. Sentry/console output ends up in prod logs. | CWE-532 |
| Do not stash secrets in source, `.env.example`, or test fixtures. | Read from `process.env`; validate at boot. Real values live in `.env` (gitignored) and the prod box. | CWE-798 |
| Do not trust the multer-uploaded `originalname`, MIME, or path. | Validate extension server-side, regenerate filename via `lib/getSafeFilename`, cap size, scan zip entries before extracting. | CWE-22, CWE-434 |
| Do not extract zips/apkg without checking entry names for `..`, absolute paths, or symlinks. | Reject any entry where the resolved path escapes the destination dir (see `lib/zip` helpers). | CWE-22 |
| Do not skip Stripe / Notion webhook signature verification. | Verify HMAC against the raw body (not the parsed JSON) using the secret from env. Reject with 401 on mismatch. | CWE-345 |
| Do not put auth checks inside controllers. | Authenticate in `routes/middleware/`; expose the user via `res.locals` so handlers see a trusted shape. | CWE-862 |
| Do not return raw error objects, stack traces, or DB error text to the client. | Log internally, send a generic message via `routes/middleware/ErrorHandler`. | CWE-209 |
| Do not stream user-supplied HTML/markdown to the client without sanitization. | Use `sanitize-html` with the project's allowlist; never disable it for "trusted" Notion content. | CWE-79 |
| Do not store passwords in plain text or with a fast hash. | Use `bcryptjs.hash` with the project's cost factor; compare with `bcrypt.compare`. | CWE-916 |
| Do not sign or verify JWTs with a hardcoded fallback secret. | Require `process.env.SECRET`; fail to boot if missing in production. | CWE-321 |
| Do not pipe `curl ... | sh` in scripts, hooks, or Dockerfiles. | Pin a release, verify checksum, then execute. | CWE-494 |
| Do not call `JSON.parse` on user input without a try/catch and a schema check. | Wrap in try/catch; validate the shape before using. | CWE-20 |
| Do not write user-controlled paths via `fs.writeFile`/`createWriteStream`. | Resolve against a base dir, then assert `resolved.startsWith(baseDir + path.sep)`. | CWE-22 |
| Do not silently swallow `await` rejections in request handlers. | Let async errors hit `ErrorHandler` middleware; never `.catch(() => {})`. | CWE-755 |
| Do not index a plain object literal with a client-supplied string to look up an allowlisted value. `{a: 1}['toString']` is `Object.prototype.toString`, not `undefined`, so `?? fallback` never fires and a Function escapes the allowlist. | Use a `Map`, `Object.create(null)`, or guard with `Object.hasOwn(table, key)`. Two occurrences so far: the legal-prerender route map (fixed 2026-09-28) and the photo-to-deck client allowlist (fixed 2026-10-01, where the escaped Function was then dropped by `JSON.stringify` so the analytics prop vanished silently). Live same-shape sites remain in `lib/notion-render/highlightCode.ts` and `lib/parser/Settings/helpers/normalizeStoredTemplates.ts`. | CWE-1321 |
| Do not disable TLS certificate validation (`rejectUnauthorized: false`) on any outbound call. | There is no legitimate case here — every host we call presents a valid certificate. If a local tool needs a self-signed cert, pin that cert rather than disabling validation. | CWE-295 |
| Do not use `Math.random()` for identifiers, keys, tokens, or anything that ends up in code SonarCloud scans. Sonar's `typescript:S2245` flags every occurrence as a security hotspot regardless of intent. | Use `crypto.randomUUID()` (browser + Node 14.17+) for IDs, or `crypto.getRandomValues(new Uint8Array(n))` for tokens. Both are cryptographically secure and silence the hotspot. **Carve-out:** retry/backoff jitter (`0.5 + Math.random()` in `withRetry.ts` / `withStripeRetry.ts`) is not a security context — leave it; if Sonar flags it, mark the hotspot reviewed rather than swapping in `crypto`. | CWE-338 |
