## Spec: Update payment details from /account

### Trio synthesis
- PM: web-only portal link on `/account` for Stripe-billed subscribers with one click event; success = portal-link support emails trend to zero; riskiest assumption is that the portal login page's email round-trip is acceptable.
- Designer: neutral secondary button "Update payment details" before Cancel, `active` state only, new tab, one muted helper line that sets the email expectation; must not inherit `.secondaryButton`'s red danger hover.
- Engineer: no server portal-session route exists; `subscription.updatePayment` is an orphaned key already translated in all 10 locales; gate on `view.kind`; portal `payment_method_update` and the PayPal-to-card switch are dashboard facts Alexander confirms before merge; effort S.
- Agreement: web-only, reuse `STRIPE_CUSTOMER_PORTAL_URL`, no deep-linked portal session in v1, no in-app card form, hidden for Apple, lifetime, cancelled and claim-mismatch states, `target="_blank" rel="noopener noreferrer"`, one analytics event in both allowlists, changelog, browser attestation.
- Conflict: states (PM active+paused+multiple, engineer active+paused+scheduled, designer active only) resolved to active only; element (PM text link vs designer button) resolved to button because discoverability is the reported defect; label (PM new "Manage billing" vs reuse) resolved to the already-translated "Update payment details"; event name unified to `subscription_manage_billing_clicked`.
- Resulting plan: one neutral button plus helper line in the `active` branch of `SubscriptionManagement`, opening the portal login page in a new tab, one click event, one new i18n key in 10 locales, changelog.

**Outcome**: A Stripe-billed subscriber can reach the billing portal from `/account` and change their card without emailing support. Success = portal-link support requests in weekly triage reach zero within 30 days, and `subscription_manage_billing_clicked` shows weekly use.

**Goal alignment**: Retention lever. `/account` is the retention surface and 78% of churn is lifecycle; an expired or wrong card with no findable fix becomes a failed renewal and a silent cancel. Read: portal-link support-email count in weekly triage plus the `subscription_cancel_started` reason mix; T+30d review issue opened at merge.

**Problem**: `SubscriptionManagement` offers exactly one action, Cancel. The portal is linked only from the footer, the login page and the scheduled-cancellation email, so a subscriber who wants to keep paying but change their card emails support for a link. A paying subscriber on a legacy monthly rate asked support for exactly that on 2026-08-26 (they wanted to move to a debit card without losing their rate).

**Riskiest assumption**: The Stripe portal login page (enter email, receive a one-time link) is low-friction enough that subscribers finish the card change instead of bouncing at "check your inbox" and emailing support anyway.

**Smallest test**: Ship the button plus the click event. Over two weeks compare `subscription_manage_billing_clicked` against portal-link support emails. High clicks with flat emails means the login page is the friction and v2 is a server-created `billingPortal.sessions` deep link.

**What this removes**: The support round-trip for the most common billing request. It also revives an orphaned, fully translated string (`subscription.updatePayment`) instead of adding a new label.

**Primary action**: Manage your subscription. The new button is a constructive secondary that sits ahead of the destructive Cancel; the status line stays dominant.

**Default behavior**: Every Stripe-billed subscriber in the `active` view sees the button. No toggle.

**Surface vocabulary**: `/account` subscription section. Reuses the existing `.actions` row and secondary button shape with a neutral hover variant (mirrors the `.pauseChip` override).

**Scope**:
- In: one anchor styled as a neutral secondary button in the `view.kind === 'active'` branch, before Cancel, `href={STRIPE_CUSTOMER_PORTAL_URL}` `target="_blank" rel="noopener noreferrer"`; one muted helper sentence under the actions row; `track('subscription_manage_billing_clicked', { interval })` on click; event added to `web/src/lib/analytics/events.ts` and `src/types/AnalyticsEvents.ts`; new key `subscription.updatePaymentHelp` in all 10 locales; changelog entry.
- Out: no server route or `billingPortal.sessions`; no in-app card form; no button for `paused`, `scheduled`, `cancelled`, `none`, `MultipleSubscriptions`, Apple-billed or lifetime users; footer and login links untouched.

**User story**: As a Stripe-billed subscriber who wants to keep paying, I want to open the billing portal from `/account` so I can update my card without cancelling or contacting support.

**Acceptance criteria**:
- [ ] "Update payment details" renders in the `active` state before "Cancel subscription" and nowhere else.
- [ ] The anchor points at `STRIPE_CUSTOMER_PORTAL_URL` with `target="_blank"` and `rel="noopener noreferrer"`.
- [ ] Hover on the new button stays neutral (no `--color-danger` text or border).
- [ ] Helper line reads "You'll get a secure link by email, and your plan and price stay the same." and ships in all 10 locales.
- [ ] Clicking fires `subscription_manage_billing_clicked` once; `events.parity.test.ts` passes.
- [ ] Vitest covers presence in `active`, absence in `paused`, `scheduled`, `cancelled`, `none` and Apple, href and rel attributes, and the click event.
- [ ] Changelog JSON added; browser attestation on `/account` as an active Stripe subscriber, including 375px.

**Open questions**:
- Alexander confirms in the Stripe dashboard (Settings, Billing, Customer portal) that payment method update is on and card is an allowed type, and that a PayPal-billed subscription can switch to a card there. The repo records neither; the spec does not claim it.
- Does the PayPal-billed population sit in Stripe Billing at all? If not, the button serves the Stripe majority and the helper copy must not overclaim.

**Out of scope (next iteration)**: Server-created portal session for an authenticated subscriber (no email round-trip) if the smallest test shows login-page friction; showing the button in `paused` if resume-time card failures appear in the data.

### Design notes
- Element: `<a>` styled `styles.manageBillingButton` (composes `secondaryButton`, neutral hover: background unchanged, text `--color-text-primary`, border `--color-border`). Order inside `.actions`: Update payment details, then Cancel subscription.
- Helper under the actions row using `sharedStyles.smallDescription`.
- Copy: `subscription.updatePayment` = "Update payment details" (exists, reuse); `subscription.updatePaymentHelp` = "You'll get a secure link by email, and your plan and price stay the same." (new, 10 locales, flag for a native pass on "secure link").
- States: `active` only. Apple, lifetime, cancelled, none, scheduled, paused and multiple-subs panels unchanged.

### Technical pre-flight
- Layers: `web` only, plus `src/types/AnalyticsEvents.ts` for the event allowlist. No route, controller or use case.
- Files: `web/src/pages/AccountPage/components/SubscriptionManagement.tsx`, `SubscriptionManagement.test.tsx`, `SubscriptionManagement.i18n.test.tsx`, `web/src/pages/AccountPage/AccountPage.module.css`, `web/src/lib/i18n/locales/{de,en,es,fr,it,ja,nl,pl,pt,ru}/account.json`, `web/src/lib/analytics/events.ts`, `src/types/AnalyticsEvents.ts`, `web/src/pages/WhatsNewPage/changelog/2026-08-27-update-payment-details.json`.
- Verified: `STRIPE_CUSTOMER_PORTAL_URL` is used only in `Footer.tsx`, `LoginForm/index.tsx` and the scheduled-cancellation email template; no `billingPortal` code exists server-side. Lifetime users resolve to `view.kind === 'none'` in `useStripeSubscriptions`, so a `view.kind` gate excludes them without a `planSource` check.
- Tests: mirror the existing pattern (mock `useStripeSubscriptions`, `QueryClientProvider`, `locals={{ subscriber: true, planSource: 'stripe' }}`); assert `toHaveAttribute('rel', 'noopener noreferrer')` as `WhatsNewPage.test.tsx` does.
- Security: fixed external URL, no user input, no SSRF surface. Effort: S.
