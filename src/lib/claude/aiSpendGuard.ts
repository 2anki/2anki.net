import { track } from '../../services/events/track';
import { HttpCodedError } from '../errors/HttpCodedError';
import type { IAiSpendReader } from '../../data_layer/AiUsageMetricsRepository';
import { computeAiCreditBalance, AiCreditBalance } from './aiCredits/balance';
import {
  RESERVED_CREDITS_PER_INFLIGHT_CALL,
  releaseInflightCredits,
  reserveInflightCredits,
  reservedCreditsFor,
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

export interface AiBudgetDeps {
  computeBalance: (
    userId: number,
    now: Date
  ) => Promise<AiCreditBalance | null>;
  reader: IAiSpendReader;
  sendAlert: (subject: string, body: string) => Promise<void>;
  now?: () => Date;
}

export interface AiBudgetStatus {
  exhausted: boolean;
  balance: AiCreditBalance | null;
}

function defaultDeps(): AiBudgetDeps {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { getDatabase } = require('../../data_layer');
  const {
    AiUsageMetricsRepository,
  } = require('../../data_layer/AiUsageMetricsRepository');
  const {
    createAiCreditReaders,
  } = require('../../data_layer/createAiCreditReaders');
  const {
    getDefaultEmailService,
  } = require('../../services/EmailService/EmailService');
  const { SUPPORT_CC_ADDRESS } = require('../constants');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const database = getDatabase();
  const readers = createAiCreditReaders(database);
  const usage = new AiUsageMetricsRepository(database);
  return {
    computeBalance: (userId: number, now: Date) =>
      computeAiCreditBalance(userId, now, readers),
    reader: usage,
    sendAlert: (subject: string, body: string) =>
      getDefaultEmailService().sendAiSpendAlertEmail(
        SUPPORT_CC_ADDRESS,
        subject,
        body
      ),
  };
}

// Fires the exhausted event at most once per allowance window. Detached and
// deduped by the ledger so any observer of a ≤ 0 balance — the pre-check, the
// per-chunk guard, the per-page guard — records exactly one event per window.
function fireExhaustedOnce(
  deps: AiBudgetDeps,
  userId: number,
  windowStart: Date
): void {
  void deps.reader
    .eventCountSince(EXHAUSTED_EVENT, userId, windowStart)
    .then((already) => {
      if (already === 0) {
        track(EXHAUSTED_EVENT, { userId, props: {} });
      }
    })
    .catch((error) =>
      console.error('[ai-credits] exhausted-event dedup failed', error)
    );
}

// Reads the caller's credit balance and, when it is spent, records the
// exhausted event once per window. This is the single place the event fires;
// the badge read (computeAiCreditBalance) never does. Fails open — a metrics
// outage never blocks a paying conversion.
export async function getAiBudgetStatus(
  userId: number | null | undefined,
  deps?: AiBudgetDeps
): Promise<AiBudgetStatus> {
  if (userId == null) {
    return { exhausted: false, balance: null };
  }
  try {
    const resolved = deps ?? defaultDeps();
    const now = resolved.now?.() ?? new Date();
    const balance = await resolved.computeBalance(userId, now);
    if (balance == null) {
      return { exhausted: false, balance: null };
    }
    // Boundary matches the number the user sees: the rounded `credits`, not
    // `rawCredits`, so "0 AI credits left" and "out of credits" always agree.
    if (balance.credits <= 0) {
      fireExhaustedOnce(resolved, userId, balance.windowStart);
      return { exhausted: true, balance };
    }
    return { exhausted: false, balance };
  } catch (error) {
    console.error('[ai-credits] balance read failed, failing open', error);
    return { exhausted: false, balance: null };
  }
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
  track(ALERT_EVENT, { userId, props: {} });
  await deps.sendAlert(
    `[2anki] AI spend alert — user ${userId} crossed $${AI_SPEND_ALERT_THRESHOLD_USD} in 30 days`,
    `User ${userId} is at $${cost30d.toFixed(2)} of AI spend over the ` +
      `trailing 30 days (alert threshold $${AI_SPEND_ALERT_THRESHOLD_USD}). ` +
      `No enforcement has happened — this is the watch signal. Per-user ` +
      `breakdown: /ops AI usage.`
  );
}

// The caller has no capacity for another metered call when the recorded
// balance, less the credits already reserved by in-flight calls, is spent.
// Subtracting reservations is what stops N concurrent chunks or pages from all
// passing on the same pre-call balance and overshooting the allowance N-fold.
function isBudgetSpent(status: AiBudgetStatus, userId: number): boolean {
  if (status.balance == null) {
    return status.exhausted;
  }
  return status.balance.credits - reservedCreditsFor(userId) <= 0;
}

// Pre-call guard for every metered Claude surface. Throws
// AiCreditsExhaustedError once the caller's plan allowance is spent; the
// interactive surfaces render that as a calm stop, and the upload path catches
// it to ship what was produced so a conversion never hard-fails at zero. Fails
// open on a read error. Skips anonymous callers, which the isPaying AI gate
// already excludes.
export async function assertAiBudget(
  userId: number | null | undefined,
  deps?: AiBudgetDeps
): Promise<void> {
  if (userId == null) {
    return;
  }
  let resolved: AiBudgetDeps;
  try {
    resolved = deps ?? defaultDeps();
  } catch (error) {
    console.error('[ai-credits] guard init failed, failing open', error);
    return;
  }
  const status = await getAiBudgetStatus(userId, resolved);
  // The watch alert is an ops signal, not part of the paying call's critical
  // path, so it runs detached — a slow or failing email never delays or breaks
  // a conversion.
  const now = resolved.now?.() ?? new Date();
  void maybeNotifyAlert(resolved, userId, now).catch((error) =>
    console.error('[ai-credits] spend alert check failed', error)
  );
  if (isBudgetSpent(status, userId)) {
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
// second conversion for the same user in another worker thread does not share
// them, so overshoot is bounded per process, not eliminated cluster-wide.
export async function withAiBudget<T>(
  userId: number | null | undefined,
  run: () => Promise<T>,
  deps?: AiBudgetDeps
): Promise<T> {
  if (userId == null) {
    return run();
  }
  let resolved: AiBudgetDeps;
  try {
    resolved = deps ?? defaultDeps();
  } catch (error) {
    console.error('[ai-credits] guard init failed, failing open', error);
    return run();
  }
  const status = await getAiBudgetStatus(userId, resolved);
  const now = resolved.now?.() ?? new Date();
  void maybeNotifyAlert(resolved, userId, now).catch((error) =>
    console.error('[ai-credits] spend alert check failed', error)
  );
  if (isBudgetSpent(status, userId)) {
    // getAiBudgetStatus already fires the event when the raw balance is spent;
    // the reservation-throttled stop (positive balance, no headroom left) is
    // the case it never sees, so record it here.
    if (status.balance != null && status.balance.credits > 0) {
      fireExhaustedOnce(resolved, userId, status.balance.windowStart);
    }
    throw new AiCreditsExhaustedError();
  }
  reserveInflightCredits(userId, RESERVED_CREDITS_PER_INFLIGHT_CALL);
  try {
    return await run();
  } finally {
    releaseInflightCredits(userId, RESERVED_CREDITS_PER_INFLIGHT_CALL);
  }
}
