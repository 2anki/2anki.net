# Split UsersControllers and end inline repository construction

Spec for #4201 (from the 2026-08-22 architecture review). Tier 3: the file
under the knife is the auth+subscription rail; nothing here builds unattended.

## Problem

src/controllers/UsersControllers.ts is 1,534 lines fusing three unrelated
domains: auth (login/register/password/magic-link), five OAuth providers, and
subscription lifecycle (cancel/pause/resume/status). It takes raw Knex and
constructs UsersRepository inline at ~10 call sites; ~26 controllers across
the cluster share the inline-construction pattern (the harmful slice of the
254 layer-skip warnings).

## Plan (three phases, three PRs, in order)

1. Carve the subscription block first: move cancel/pause/resume/status into a
   new SubscriptionLifecycleController with constructor-injected repositories;
   routes point at it; UsersControllers shrinks and loses its billing half.
   The deploy build typechecks tests (tsc -p .), so every test mock typed
   against a changed interface updates in the same PR.
2. Split the remainder into AuthController and OAuthController; inject
   repositories once via constructors across the ~26-controller cluster, ~5
   controllers per PR if needed to keep diffs reviewable.
3. Carve router-level composition-root edges out of the depcruise
   no-layer-skip rule (legitimate DI wiring), then tighten the rule to error
   severity for src/controllers so the debt cannot regrow.

## Constraints

- Pure moves: no behavior change, no route path changes, no response shape
  changes. Outside-in tests keep passing untouched wherever possible; moved
  tests move with their controller.
- Every phase lands green on the FULL server suite + tsc -p . --noEmit; the
  #3908 rule applies (shared-surface refactor: full suites, not targeted).
- Rail: UsersControllers, UserRouter, subscription surfaces. Each PR goes
  ready with the review verdict and waits for Alexander.

## Out of scope

Fixing the depcruise debt outside the controllers cluster; any change to
auth/subscription logic itself; renames of public route paths.

## Metric

None - internal. Exit criteria: UsersControllers < 400 lines, zero inline
getDatabase()/new Repository() in src/controllers, depcruise
no-layer-skip-to-data-layer at error severity for controllers.
