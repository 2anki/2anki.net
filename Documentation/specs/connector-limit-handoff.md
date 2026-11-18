## Spec: Connector limit handoff

### Trio synthesis
- PM: the drop happens inside the chat, before the website is opened; fix the message and the link and measure the click on the server; do not build the page yet.
- Designer: keep the order "what you got, what is saved, when free cards reset, one link" and drop everything that reads as an ad; exact copy for each state below.
- Engineer: the link must carry no credential and no per-user reference; arrivals are recognised by the normal session; checkout, email prefill and saved cards already exist.
- Agreement: no sign-in link, nothing account-specific before a normal sign-in, the directory rule on connector links is binding, no trials, new plans, inline card form or marketing page.
- Conflict: page first or message first (message first; the page is a later stage, built only if the click rate moves); link label ("See the N saved cards", not "Unlock"); a per-wall id on the link or none (none); split or trend read (split by user id parity, read on click rate).
- Resulting plan: measure the handoff on the server, then test one quieter, clearer limit message against today's.

### Outcome
More of the people shown the connector's monthly limit open the link in that message. Leading indicator: share of users shown the limit who arrive from the connector link within 24 hours, test arm against control. Keep the new message if it beats control by at least 8 points after 30 days.

### Goal alignment
Simpler and faster: the saved cards are a deck the person already asked for, and the message is the shortest path to it. Read from the `events` table 30 days after the test starts. Purchase volume from the connector is too low to be the decision metric; it is a guardrail.

### Problem
Someone asks their chat for flashcards, gets fewer cards than the deck holds, and is told "Plans on 2anki.net:" with a generic link. The message does not lead with what they got, does not label the link by what it shows, and in the refusal case puts the link at the end of a sentence where the model often drops it. Most people shown the limit never open the link, and we cannot see what happens to a signed-out arrival, because the only arrival event is sent by the browser.

### Riskiest assumption
People who hit the limit want the saved cards now and are lost to how the link is presented, rather than being content to wait for the free reset.

### Smallest test
Count link arrivals on the server per limit shown (stage 1a, no user-visible change). If arrivals stay low after the message names the saved cards and the date (stage 1b), demand is the problem and stages 2 and 3 are not built.

### What this removes
The "Plans on 2anki.net:" header, the link buried in the refusal sentence, and the link itself when nothing is held and the deck was delivered in full.

### Primary action
Open the one link in the limit message.

### Default behavior
Control arm: today's message, unchanged. Test arm (users with an even id): the new message. No setting, no flag in the environment.

### Surface vocabulary
The connector's existing tool results and the existing `/pricing?ref=mcp` page, which already leads with the Day Pass for connector arrivals. No new page in stage 1.

### Scope
Prerequisite, stage 1a (measurement only, nothing a user sees changes; approved to ship now as its own PR, ahead of this spec):
- Record an arrival on the server when `/pricing` is requested with `ref=mcp`: the limit kind (`k` = held, partial or limit), the arm, and whether the request carried a session. Routes → controller → use case; no identifier in the link.
- Add `arm` to the connector's `paywall_shown` event.
- Keep `held_until`, `k` and the arm through the sign-in return from `/pricing` (`resolvePricingReturn` keeps only `ref` and `interval` today).
- Use the existing `connector` checkout surface for checkouts started from a connector arrival.

In, stage 1b (the test; this PR):
- New message for the test arm in the three limit results: part of the deck delivered and the rest saved; nothing delivered and the deck saved; refused and not saved.
- The link on its own line in each, labelled "See the N saved cards:" when cards are saved.
- Structured `next_step` fields that say the same: `state`, `cards_delivered`, `cards_saved`, `saved_until`, `free_resets_on`, `fits_free_after_reset`, `link` (label and url). `plans_url`, `upgrade_url`, `cards_held_back` and `held_until` stay as aliases for one release.
- Server instruction updated to "show the link label and url exactly as written".

Out: a `/connector` page, a sign-in or session link, any per-user or per-limit reference in the link, a link that starts a checkout, prices or plan names in tool text, trials, new plans or Stripe settings, an inline payment form, release of saved cards on the payment webhook, changes to the free limit or to how long saved cards are kept.

### User story
As a learner who asked my chat for a deck and got part of it, I want to be told plainly what I got, what is saved and until when, and what my free option is, so that I can decide whether to get the rest now.

### Acceptance criteria
- [ ] Part delivered, rest saved (test arm). The model is told to say: the deck has X of its Y cards, which is what was left of this month's free cards; the other N cards are saved on the account until `<date>`; free cards reset on `<date>`. When the full deck fits the free allowance: "they can ask again after that and the full deck fits". Otherwise: a deck this size is over the monthly limit. Then, on its own line: `See the N saved cards: <url>`.
- [ ] Nothing delivered, deck saved: the same order, opening with why no file was made.
- [ ] Refused and not saved: says the deck was not made or saved and when free cards reset, then a plain plans line on its own line.
- [ ] Deck delivered in full with the allowance now used up: one sentence with the reset date, and no link.
- [ ] The message never says the saved cards arrive at the reset (they are kept 7 days, then deleted), never tells the model to recommend or persuade, uses no urgency, and does not contain the words upgrade, pricing or checkout (the existing test stays).
- [ ] The deck title appears only in structured fields and inside the untrusted-data wrapper, as today.
- [ ] The link is `https://2anki.net/pricing/?ref=mcp&k=<kind>&a=<arm>` plus `held_until` when cards are saved; dropping or mangling any parameter still lands on a working page.
- [ ] A request for that page records one server-side arrival with kind, arm and `signed_in`. Raw requests are counted; repeats are removed when the numbers are read.
- [ ] Signing in from that page returns to it with `held_until`, `k` and the arm intact; any other parameter is dropped.
- [ ] Control-arm results are byte-for-byte today's. Arm assignment is by user id parity and is stable.
- [ ] New event names are added on web and server in the same PR where both sides use them (parity test).
- [ ] Old links in existing chats (`/pricing/?ref=mcp&held_until=…`) keep working.

### Open questions
- Decided: saved cards stay as they are (kept 7 days, then deleted). Releasing them at the reset is revisited after this test has a result, so the test measures one thing.
- Decided: stage 1a ships now. The message test (this PR) starts only after the pending checkout read.
- Decided: the connector keeps holding cards past the free limit for the length of the test.
- [NEEDS CLARIFICATION: does changing the server instruction wording require a directory re-review? Default: treat the existing rule as binding and keep the change minimal.]
- [NEEDS CLARIFICATION: is the 30-day test window long enough at current connector volume, or should the read wait for a fixed number of users per arm?]

### Out of scope (next iteration)
- Stage 2, only if stage 1b moves the click rate and the `signed_in` share shows the next drop: a `/connector` page behind normal sign-in (heading with the count, one primary action, a four-row readout of delivered, saved, kept until and free reset, the free alternative, a quiet "See all plans"), a summary endpoint, a sign-in return entry, a usage event and a 30-day keep-or-remove review.
- Stage 3: `list_my_decks` shows released connector decks, and the next tool result says once that the saved cards are now in the deck.

### Design notes
- Order in every state: delivered, saved and until when, free reset, the honest free option, one link. Shorter than today.
- "Your chat", not a product name: the same text goes to more than one client.
- No link when nothing is saved and the deck was delivered: a link there is only advertising.
- Dates are written out in the message; structured fields carry ISO dates.

### Technical pre-flight
- Verified in code: the plans link and its rule comment (`McpToolsService.ts`, `PLANS_URL`); the copy test that rejects upgrade, pricing and checkout (`McpToolsService.test.ts`); the 7-day hold (`PLAN_HOLD_TTL_MS` in `UploadService.ts`); `resolvePricingReturn` keeping only `ref` and `interval` (`getRedirect.ts`); checkout surfaces parsed in `usecases/checkout/checkoutSurface.ts`.
- Platform check: Stripe's hosted checkout already prefills the email or reuses the customer for a signed-in buyer and offers saved payment methods; nothing here writes to Stripe.
- Layers: `services/mcp` (message, fields, instruction), `routes`/`controllers`/`usecases` (server arrival record), `controllers/helpers` (sign-in return), `types/AnalyticsEvents.ts` and `web/src/lib/analytics/events.ts`.
- Stage 1a is a separate measurement PR that ships first so the control baseline exists; this PR is stage 1b, small to medium (message and fields).
- Security: no token, reference or account data in the link; arm and kind are validated against fixed sets before being recorded; nothing account-specific is rendered before sign-in. The sign-in return change touches an auth-adjacent helper and needs a security pass.
- Tests: message builders and structured fields per state and per arm, the copy test, the arrival record (signed in and out, bad parameters), the return allowlist, arm stability.
