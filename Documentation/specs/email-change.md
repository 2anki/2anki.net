# Self-serve email change on /account

Part of #4303 (the ops-command half ships separately; this spec covers the
user-facing flow). Trio-consulted 2026-09-01; Tier 3 because it carries a
migration.

## Problem

No way to change an account email exists. A paying user who lost their old
inbox is one forgotten password from lockout; the only path today is manual
SQL. The claim form gets mistaken for an email-change control.

## Flow (designer-locked)

Inline under the read-only email in UserProfile, mirroring ClaimSubscription's
collapsed-toggle pattern. States: (A) collapsed "Change email" ghost toggle;
(B) form: New email + Current password, one primary "Send confirmation link";
(C) sent: "Check your new inbox." with resend / use-a-different-email;
(D) pending badge on reload with resend + cancel change;
(E) confirm landing page from the emailed link -> "Email updated." ->
/account?email_changed=1 success banner (reuse the ?verified=1 pattern).
Errors inline role=alert: wrong password, email in use, invalid, same as
current, generic. Copy per the designer consult (sentence case, no
exclamation marks). a11y mirrors CancelFlow (fieldset focus, live regions,
real labels).

## Security shape (locked)

- Re-auth: comparePassword against the current password. OAuth-only accounts
  (bcrypt-random placeholder) get a clear "set a password first" path, not a
  401. Resolving a passwordless re-auth alternative is v2, not this spec.
- Confirmation link to the NEW address; the change applies only on click.
- Notice email to the OLD address at REQUEST time (hijack victim gets a
  window to react before the change lands).
- Uniqueness checked at request time AND re-checked inside the confirm
  transaction (a second signup can claim the address during the window; the
  confirm must fail cleanly, never merge accounts).
- On completion: apply users.email + subscriptions.linked_email in one
  transaction (the pair that keeps cancelUnlinkedSubscriptions from sweeping
  a paying user), mark token consumed, deleteAllForOwner (every session
  re-authenticates after an identity change). Never touch subscriptions.email
  (Stripe payer mirror) or historical log tables.

## Build (engineer-locked)

- Migration: new email_change_tokens table (id, user_id, new_email,
  token_hash, expires_at, consumed_at, created_at) mirroring
  subscription_claim_tokens; magic_tokens cannot carry the target address.
  kanel regeneration committed in the same PR (hard gate).
- New EmailChangeTokenRepository (+ in-memory twin).
- UsersControllers (RAIL): requestEmailChange + confirmEmailChange.
- UserRouter (RAIL): POST /api/users/email-change/request (authed) +
  /confirm (token-authed).
- EmailService: sendEmailChangeConfirmationEmail(new, link) +
  sendEmailChangeNotificationEmail(old, new); templates structurally match
  reset.html per .claude/docs/email-templates.md; transactional, no
  unsubscribe footer.
- Web: ChangeEmail.tsx under UserProfile; confirm landing route added to BOTH
  web/src/App.tsx and src/routes/knownRoutes.ts; accountx namespace keys in
  all 10 locales; events email_change_requested / email_change_confirmed in
  both analytics allowlists.
- Same PR: retitle the claim toggle to "Link a subscription" with one clause
  making clear it does not change the sign-in email.

## Out of scope

Passwordless re-auth for OAuth-only accounts (v2, needs its own security
review); changing the Stripe customer email; any admin UI beyond the separate
ops command.

## Tests

Repository single-use/expiry; controller: 401 wrong password, 400 invalid,
409 taken, confirm race (seed a colliding account created after the token ->
clean failure), both mails to the right addresses, deleteAllForOwner called;
SQL-shape test for the transactional update; web component + i18n parity.

## Metric

"Paid but locked out / change my email" support threads -> 0; secondary,
email_change_confirmed volume at /api/ops/metrics.
