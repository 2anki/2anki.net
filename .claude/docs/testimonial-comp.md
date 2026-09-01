# Testimonial comp — reply flow

When a support email contains unprompted praise, offer a comp in exchange for a
consented public quote. Phase 1 is collection only: no wall, no UI, no table.
The v2 landing-page wall is gated on >= 5 consented quotes; do not start it
before then.

## The offer (what "3 free months" is)

A 90-day `user_passes` row at the `unlimited` kind, granted by hand:

    INSERT INTO user_passes (user_id, kind, expires_at, stripe_payment_intent_id, created_at)
    VALUES (<id>, 'unlimited', now() + interval '90 days', 'comp:testimonial:' || gen_random_uuid(), now());

- `findActive` filters on `user_id` + future `expires_at`, so the pass sets the
  normal paid tier (`res.locals.subscriber`). Self-expiring - nothing to revoke.
- The `comp:` sentinel mirrors the `apple:` prefix precedent and cannot collide
  with a real payment intent.
- Never `users.patreon`, never `ankify_access` (wrong gate - that is the
  Auto-Sync comp), never a synthetic `subscriptions` row.
- A comp pass shows `planSource = null` on the account view. Known and fine at
  this volume; not a bug.

## The reply template

Support-email rules apply: saved to `~/Downloads/reply-<name>.txt`, no dashes,
no gender inference, first-name salutation, sentence case, no exclamation marks.

    Hi <first name>,

    Thank you, that genuinely made my day.

    Would you let me quote you publicly? I would use your first name, last
    initial and what you study, nothing more. And if you felt like posting a
    short review anywhere you already use, that helps more than you would
    guess.

    Either way, I have added 3 months of the full plan to your account as a
    thank you. Unlimited cards, PDF support and the higher mindmap limits. No
    card required, it just works the next time you sign in.

    Happy learning,

    Alexander

## Consent and attribution rules

- Publish only quotes with written consent; keep the consent message in the
  private store, tied to the numeric user ID.
- Attribution defaults to first name + last initial + role ("Nasir K., med
  student"). Never full name, email, workspace name, deck titles, filenames or
  course names. Never infer pronouns or titles.
- Honor withdrawal requests without argument.
- Reviews the user posts on external sites are their own act; the piece we
  control and gate on consent is our quote.

## Logging

Collected quotes and consents live in a private, non-repo store (same rule as
support replies in Downloads). The repo never carries a real name or quote.
Count consented quotes at T+30; >= 5 unlocks the v2 wall spec, < 5 kills it.

## What not to build

No wall yet, no ops command or button (manual psql is proportionate below
5 grants/month), no testimonials table, no EmailService template, no praise
detection.
