import { track } from '../../services/events/track';
import { withServerMarker } from '../events/serverEventProps';
import { HttpCodedError } from '../errors/HttpCodedError';
import {
  AiUsageMetricsRepository,
  type IAiSpendReader,
  type IAnonymousPassSpendReader,
} from '../../data_layer/AiUsageMetricsRepository';
import { getDatabase } from '../../data_layer';
import { createAiCreditReaders } from '../../data_layer/createAiCreditReaders';
import { createAnonymousPassCreditReaders } from '../../data_layer/createAnonymousPassCreditReaders';
import { getDefaultEmailService } from '../../services/EmailService/EmailService';
import { SUPPORT_CC_ADDRESS } from '../constants';
import { computeAiCreditBalance, AiCreditBalance } from './aiCredits/balance';
import { computeAnonymousPassBalance } from './aiCredits/anonymousPassBalance';
import {
  RESERVED_CREDITS_PER_INFLIGHT_CALL,
  releaseInflightCredits,
  releaseInflightCreditsForPass,
  reserveInflightCredits,
  reserveInflightCreditsForPass,
  reservedCreditsFor,
  reservedCreditsForPass,
} from './aiCredits/inflightReservations';

// A user crossing $25 in 30 days costs more than triple the subscription
// price — worth a human look, not enforcement. Kept as an ops signal; part 2's
// credit packs are the only realistic way to reach it now that plan allowances
// cap ordinary spend.
export const AI_SPEND_ALERT_THRESHOLD_USD = 25;

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_WINDOW_MS = 30 * DAY_MS;
const ALERT_DEDUP_MS = 7 * DAY_MS;

const ALERT_EVENT = 'ai_spend_alert_sent';
const EXHAUSTED_EVENT = 'ai_credits_exhausted';

export class AiCreditsExhaustedError extends HttpCodedError {
  constructor() {
    super(
      "You're out of AI credits. They come back when your allowance resets.",
      402,
      'ai_credits_exhausted'
    );
  }
}

// Who a metered call bills against: a signed-in user, or an anonymous pass
// holder identified by their pass row. A bare number stays shorthand for a user
// so the signed-in call sites read unchanged.
export type AiSpendSubject =
  | number
  | null
  | undefined
  | { userId?: number | null; anonymousPassId?: number | null };

interface NormalizedSubject {
  kind: 'user' | 'pass' | 'none';
  userId: number;
  anonymousPassId: number;
}

function normalizeSubject(subject: AiSpendSubject): NormalizedSubject {
  if (subject == null) {
    return { kind: 'none', userId: 0, anonymousPassId: 0 };
  }
  if (typeof subject === 'number') {
    return { kind: 'user', userId: subject, anonymousPassId: 0 };
  }
  if (subject.userId != null) {
    return { kind: 'user', userId: subject.userId, anonymousPassId: 0 };
  }
  if (subject.anonymousPassId != null) {
    return {
      kind: 'pass',
      userId: 0,
      anonymousPassId: subject.anonymousPassId,
    };
  }
  return { kind: 'none', userId: 0, anonymousPassId: 0 };
}

export interface AiBudgetDeps {
  computeBalance: (
    userId: number,
    now: Date
  ) => Promise<AiCreditBalance | null>;
  computeAnonymousPassBalance?: (
    anonymousPassId: number,
    now: Date
  ) => Promise<AiCreditBalance | null>;
  reader: IAiSpendReader;
  passReader?: IAnonymousPassSpendReader;
  sendAlert: (subject: string, body: string) => Promise<void>;
  now?: () => Date;
}

export interface AiBudgetStatus {
  exhausted: boolean;
  balance: AiCreditBalance | null;
}

function defaultDeps(): AiBudgetDeps {
  const database = getDatabase();
  const readers = createAiCreditReaders(database);
  const passReaders = createAnonymousPassCreditReaders(database);
  const usage = new AiUsageMetricsRepository(database);
  return {
    computeBalance: (userId: number, now: Date) =>
      computeAiCreditBalance(userId, now, readers),
    computeAnonymousPassBalance: (anonymousPassId: number, now: Date) =>
      computeAnonymousPassBalance(anonymousPassId, now, passReaders),
    reader: usage,
    passReader: usage,
    sendAlert: (subject: string, body: string) =>
      getDefaultEmailService().sendAiSpendAlertEmail(
        SUPPORT_CC_ADDRESS,
        subject,
        body
      ),
  };
}

// The allowance window each subject last recorded the exhausted event in. The
// ledger read below is asynchronous and the events sink writes in batches, so
// when a 100-page PDF fans out and every per-page guard observes the same spent
// balance within the same tick, all of them read a count of zero and all of
// them fire: one user produced 102 events in 0.3s on 2026-10-15. Claiming the
// window synchronously here, before the first ledger read, is what makes the
// per-window promise hold inside one process; the ledger still dedupes across
// processes and restarts. Keyed by the window's start day, not its instant,
// because the rolling-30-day fallback derives a fresh start on every call.
// Users and anonymous passes keep separate maps so a pass id never masks a
// user id with the same number.
const claimedExhaustedWindows = new Map<number, number>();
const claimedExhaustedPassWindows = new Map<number, number>();

export function resetExhaustedWindowClaims(): void {
  claimedExhaustedWindows.clear();
  claimedExhaustedPassWindows.clear();
}

const windowClaimKey = (windowStart: Date): number =>
  Math.floor(windowStart.getTime() / DAY_MS);

function fireExhaustedOnceKeyed(
  claimedMap: Map<number, number>,
  id: number,
  windowStart: Date,
  countSince: (windowStart: Date) => Promise<number>,
  emit: () => void
): void {
  const windowKey = windowClaimKey(windowStart);
  if (claimedMap.get(id) === windowKey) {
    return;
  }
  claimedMap.set(id, windowKey);
  void countSince(windowStart)
    .then((already) => {
      if (already === 0) {
        emit();
      }
    })
    .catch((error) => {
      if (claimedMap.get(id) === windowKey) {
        claimedMap.delete(id);
      }
      console.error('[ai-credits] exhausted-event dedup failed', error);
    });
}

// Fires the exhausted event at most once per allowance window. Detached and
// deduped by the ledger so any observer of a ≤ 0 balance — the pre-check, the
// per-chunk guard, the per-page guard — records exactly one event per window.
function fireExhaustedOnce(
  deps: AiBudgetDeps,
  subject: NormalizedSubject,
  windowStart: Date
): void {
  if (subject.kind === 'user') {
    const userId = subject.userId;
    fireExhaustedOnceKeyed(
      claimedExhaustedWindows,
      userId,
      windowStart,
      (ws) => deps.reader.eventCountSince(EXHAUSTED_EVENT, userId, ws),
      () => track(EXHAUSTED_EVENT, { userId, props: withServerMarker({}) })
    );
    return;
  }
  if (subject.kind === 'pass') {
    const passReader = deps.passReader;
    if (passReader == null) {
      return;
    }
    const anonymousPassId = subject.anonymousPassId;
    fireExhaustedOnceKeyed(
      claimedExhaustedPassWindows,
      anonymousPassId,
      windowStart,
      (ws) =>
        passReader.anonymousPassEventCountSince(
          EXHAUSTED_EVENT,
          anonymousPassId,
          ws
        ),
      () =>
        track(EXHAUSTED_EVENT, { anonymousPassId, props: withServerMarker({}) })
    );
  }
}

function balanceForSubject(
  deps: AiBudgetDeps,
  subject: NormalizedSubject,
  now: Date
): Promise<AiCreditBalance | null> {
  if (subject.kind === 'user') {
    return deps.computeBalance(subject.userId, now);
  }
  if (subject.kind === 'pass') {
    return (
      deps.computeAnonymousPassBalance?.(subject.anonymousPassId, now) ??
      Promise.resolve(null)
    );
  }
  return Promise.resolve(null);
}

async function budgetStatusFor(
  subject: NormalizedSubject,
  deps: AiBudgetDeps
): Promise<AiBudgetStatus> {
  if (subject.kind === 'none') {
    return { exhausted: false, balance: null };
  }
  // A signed-in user fails OPEN: a metrics outage never blocks a paying
  // conversion, and the isPaying gate still bounds who reaches AI. An anonymous
  // pass holder fails CLOSED: with no account to fall back on, an unresolvable
  // balance (unknown, expired, non-metered, or allowance-less pass) or a reader
  // error must not hand out unmetered AI — it stops and the conversion uses the
  // standard parser.
  const exhaustedOnNoBalance = subject.kind === 'pass';
  try {
    const now = deps.now?.() ?? new Date();
    const balance = await balanceForSubject(deps, subject, now);
    if (balance == null) {
      return { exhausted: exhaustedOnNoBalance, balance: null };
    }
    // Boundary matches the number the user sees: the rounded `credits`, not
    // `rawCredits`, so "0 AI credits left" and "out of credits" always agree.
    if (balance.credits <= 0) {
      fireExhaustedOnce(deps, subject, balance.windowStart);
      return { exhausted: true, balance };
    }
    return { exhausted: false, balance };
  } catch (error) {
    console.error(
      `[ai-credits] balance read failed, failing ${exhaustedOnNoBalance ? 'closed' : 'open'}`,
      error
    );
    return { exhausted: exhaustedOnNoBalance, balance: null };
  }
}

// Reads the caller's credit balance and, when it is spent, records the
// exhausted event once per window. This is the single place the event fires;
// the badge read (computeAiCreditBalance) never does. A signed-in user fails
// open (a metrics outage never blocks a paying conversion); an anonymous pass
// fails closed (no balance means no AI).
export async function getAiBudgetStatus(
  subject: AiSpendSubject,
  deps?: AiBudgetDeps
): Promise<AiBudgetStatus> {
  const normalized = normalizeSubject(subject);
  if (normalized.kind === 'none') {
    return { exhausted: false, balance: null };
  }
  let resolved: AiBudgetDeps;
  try {
    resolved = deps ?? defaultDeps();
  } catch (error) {
    // Pass fails closed, user fails open (see budgetStatusFor).
    console.error('[ai-credits] guard init failed', error);
    return { exhausted: normalized.kind === 'pass', balance: null };
  }
  return budgetStatusFor(normalized, resolved);
}

async function maybeNotifyAlert(
  deps: AiBudgetDeps,
  userId: number,
  now: Date
): Promise<void> {
  const cost30d = await deps.reader.userCostSince(
    userId,
    new Date(now.getTime() - ALERT_WINDOW_MS)
  );
  if (cost30d < AI_SPEND_ALERT_THRESHOLD_USD) {
    return;
  }
  const dedupSince = new Date(now.getTime() - ALERT_DEDUP_MS);
  const alreadySent = await deps.reader.eventCountSince(
    ALERT_EVENT,
    userId,
    dedupSince
  );
  if (alreadySent > 0) {
    return;
  }
  track(ALERT_EVENT, { userId, props: withServerMarker({}) });
  await deps.sendAlert(
    `[2anki] AI spend alert — user ${userId} crossed $${AI_SPEND_ALERT_THRESHOLD_USD} in 30 days`,
    `User ${userId} is at $${cost30d.toFixed(2)} of AI spend over the ` +
      `trailing 30 days (alert threshold $${AI_SPEND_ALERT_THRESHOLD_USD}). ` +
      `No enforcement has happened — this is the watch signal. Per-user ` +
      `breakdown: /ops AI usage.`
  );
}

// The watch alert is an ops signal for runaway per-user spend, not part of the
// paying call's critical path, so it runs detached. Only signed-in users can
// reach the threshold — an anonymous pass caps its own spend at the pass
// allowance — so it is skipped for passes.
function maybeNotifyAlertForSubject(
  deps: AiBudgetDeps,
  subject: NormalizedSubject,
  now: Date
): void {
  if (subject.kind !== 'user') {
    return;
  }
  void maybeNotifyAlert(deps, subject.userId, now).catch((error) =>
    console.error('[ai-credits] spend alert check failed', error)
  );
}

function reservedForSubject(subject: NormalizedSubject): number {
  if (subject.kind === 'user') {
    return reservedCreditsFor(subject.userId);
  }
  if (subject.kind === 'pass') {
    return reservedCreditsForPass(subject.anonymousPassId);
  }
  return 0;
}

function reserveForSubject(subject: NormalizedSubject, credits: number): void {
  if (subject.kind === 'user') {
    reserveInflightCredits(subject.userId, credits);
    return;
  }
  if (subject.kind === 'pass') {
    reserveInflightCreditsForPass(subject.anonymousPassId, credits);
  }
}

function releaseForSubject(subject: NormalizedSubject, credits: number): void {
  if (subject.kind === 'user') {
    releaseInflightCredits(subject.userId, credits);
    return;
  }
  if (subject.kind === 'pass') {
    releaseInflightCreditsForPass(subject.anonymousPassId, credits);
  }
}

// The caller has no capacity for another metered call when the recorded
// balance, less the credits already reserved by in-flight calls, is spent.
// Subtracting reservations is what stops N concurrent chunks or pages from all
// passing on the same pre-call balance and overshooting the allowance N-fold.
function isBudgetSpent(
  status: AiBudgetStatus,
  subject: NormalizedSubject
): boolean {
  if (status.balance == null) {
    return status.exhausted;
  }
  return status.balance.credits - reservedForSubject(subject) <= 0;
}

// Pre-call guard for every metered Claude surface. Throws
// AiCreditsExhaustedError once the caller's allowance is spent; the interactive
// surfaces render that as a calm stop, and the upload path catches it to ship
// what was produced so a conversion never hard-fails at zero. A caller with
// neither a user id nor an anonymous pass id is skipped — the isPaying AI gate
// already excludes the truly anonymous. A signed-in user fails open on a read
// error; an anonymous pass holder (isPaying but signed out) is metered against
// their pass row and fails closed, so an unresolvable balance never yields
// unmetered AI.
export async function assertAiBudget(
  subject: AiSpendSubject,
  deps?: AiBudgetDeps
): Promise<void> {
  const normalized = normalizeSubject(subject);
  if (normalized.kind === 'none') {
    return;
  }
  let resolved: AiBudgetDeps;
  try {
    resolved = deps ?? defaultDeps();
  } catch (error) {
    // An anonymous pass fails closed: no readers means no way to prove the
    // pass has headroom, so it gets no AI rather than unmetered AI.
    console.error('[ai-credits] guard init failed', error);
    if (normalized.kind === 'pass') {
      throw new AiCreditsExhaustedError();
    }
    return;
  }
  const status = await budgetStatusFor(normalized, resolved);
  const now = resolved.now?.() ?? new Date();
  maybeNotifyAlertForSubject(resolved, normalized, now);
  if (isBudgetSpent(status, normalized)) {
    throw new AiCreditsExhaustedError();
  }
}

// The concurrency-safe form of the guard for the metered call sites that fan
// out (every chunk, every PDF page). It admits the call only if the balance,
// less in-flight reservations, is still positive, then reserves a conservative
// slice for the duration of the call and releases it when the call settles. The
// check-and-reserve runs synchronously after the balance read, so two
// concurrent admissions coordinate through the reservation ledger even when
// they read the same pre-call balance. Reservations live in one process; a
// second conversion for the same subject in another worker thread does not
// share them, so overshoot is bounded per process, not eliminated cluster-wide.
export async function withAiBudget<T>(
  subject: AiSpendSubject,
  run: () => Promise<T>,
  deps?: AiBudgetDeps
): Promise<T> {
  const normalized = normalizeSubject(subject);
  if (normalized.kind === 'none') {
    return run();
  }
  let resolved: AiBudgetDeps;
  try {
    resolved = deps ?? defaultDeps();
  } catch (error) {
    // An anonymous pass fails closed (see assertAiBudget); a user fails open.
    console.error('[ai-credits] guard init failed', error);
    if (normalized.kind === 'pass') {
      throw new AiCreditsExhaustedError();
    }
    return run();
  }
  const status = await budgetStatusFor(normalized, resolved);
  const now = resolved.now?.() ?? new Date();
  maybeNotifyAlertForSubject(resolved, normalized, now);
  if (isBudgetSpent(status, normalized)) {
    // budgetStatusFor already fires the event when the raw balance is spent;
    // the reservation-throttled stop (positive balance, no headroom left) is
    // the case it never sees, so record it here.
    if (status.balance != null && status.balance.credits > 0) {
      fireExhaustedOnce(resolved, normalized, status.balance.windowStart);
    }
    throw new AiCreditsExhaustedError();
  }
  reserveForSubject(normalized, RESERVED_CREDITS_PER_INFLIGHT_CALL);
  try {
    return await run();
  } finally {
    releaseForSubject(normalized, RESERVED_CREDITS_PER_INFLIGHT_CALL);
  }
}
