import { track } from '../../services/events/track';
import type { IAiSpendReader } from '../../data_layer/AiUsageMetricsRepository';

// $50 of AI spend by one user inside 24 hours is roughly eight times the
// heaviest human month on record — only a scripted client or a billing retry
// loop gets there. The breaker exists to stop a runaway while unattended, not
// to meter heavy legitimate use.
export const AI_SPEND_DAILY_CAP_USD = 50;

// A user crossing $25 in 30 days costs more than triple the subscription
// price — worth a human look, not enforcement.
export const AI_SPEND_ALERT_THRESHOLD_USD = 25;

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_WINDOW_MS = 30 * DAY_MS;
const ALERT_DEDUP_MS = 7 * DAY_MS;
const CAP_DEDUP_MS = DAY_MS;

const ALERT_EVENT = 'ai_spend_alert_sent';
const CAP_EVENT = 'ai_spend_cap_tripped';

export class AiSpendCapError extends Error {
  readonly status = 429;

  constructor(userId: number, costUsd: number) {
    super(
      `AI processing is paused for this account after unusually high usage ` +
        `(user ${userId}, $${costUsd.toFixed(2)} in 24h). Contact support@2anki.net.`
    );
    this.name = 'AiSpendCapError';
  }
}

export interface AiSpendGuardDeps {
  reader: IAiSpendReader;
  sendAlert: (subject: string, body: string) => Promise<void>;
  now?: () => Date;
}

function defaultDeps(): AiSpendGuardDeps {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { getDatabase } = require('../../data_layer');
  const {
    AiUsageMetricsRepository,
  } = require('../../data_layer/AiUsageMetricsRepository');
  const {
    getDefaultEmailService,
  } = require('../../services/EmailService/EmailService');
  const { SUPPORT_CC_ADDRESS } = require('../constants');
  /* eslint-enable @typescript-eslint/no-var-requires */
  return {
    reader: new AiUsageMetricsRepository(getDatabase()),
    sendAlert: (subject: string, body: string) =>
      getDefaultEmailService().sendAiSpendAlertEmail(
        SUPPORT_CC_ADDRESS,
        subject,
        body
      ),
  };
}

async function maybeNotify(
  deps: AiSpendGuardDeps,
  event: typeof ALERT_EVENT | typeof CAP_EVENT,
  userId: number,
  dedupMs: number,
  subject: string,
  body: string
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const dedupSince = new Date(now.getTime() - dedupMs);
  const alreadySent = await deps.reader.eventCountSince(
    event,
    userId,
    dedupSince
  );
  if (alreadySent > 0) {
    return;
  }
  track(event, { userId, props: {} });
  await deps.sendAlert(subject, body);
}

/**
 * Pre-call guard for every metered Claude surface. Throws AiSpendCapError when
 * the user's trailing-24h spend crossed the runaway cap; separately emails an
 * ops alert (deduped to one per week) when trailing-30d spend crosses the
 * watch threshold. Fails open on any read/notify error — a metrics outage must
 * never block a paying conversion.
 */
export async function guardAiSpend(
  userId: number | null | undefined,
  deps?: AiSpendGuardDeps
): Promise<void> {
  if (userId == null) {
    return;
  }
  let resolved: AiSpendGuardDeps;
  let cost24h: number;
  try {
    resolved = deps ?? defaultDeps();
    const now = resolved.now?.() ?? new Date();
    cost24h = await resolved.reader.userCostSince(
      userId,
      new Date(now.getTime() - DAY_MS)
    );
  } catch (error) {
    console.error('[ai-spend-guard] spend read failed, failing open', error);
    return;
  }
  const now = resolved.now?.() ?? new Date();

  if (cost24h >= AI_SPEND_DAILY_CAP_USD) {
    maybeNotify(
      resolved,
      CAP_EVENT,
      userId,
      CAP_DEDUP_MS,
      `[2anki] AI spend breaker tripped — user ${userId}`,
      `User ${userId} hit $${cost24h.toFixed(2)} of AI spend in 24h ` +
        `(cap $${AI_SPEND_DAILY_CAP_USD}). Their AI calls are blocked until ` +
        `the trailing 24h drops under the cap. Likely a runaway loop or a ` +
        `scripted client — check /ops AI usage.`
    ).catch((error) =>
      console.error('[ai-spend-guard] breaker notification failed', error)
    );
    throw new AiSpendCapError(userId, cost24h);
  }

  try {
    const cost30d = await resolved.reader.userCostSince(
      userId,
      new Date(now.getTime() - ALERT_WINDOW_MS)
    );
    if (cost30d >= AI_SPEND_ALERT_THRESHOLD_USD) {
      await maybeNotify(
        resolved,
        ALERT_EVENT,
        userId,
        ALERT_DEDUP_MS,
        `[2anki] AI spend alert — user ${userId} crossed $${AI_SPEND_ALERT_THRESHOLD_USD} in 30 days`,
        `User ${userId} is at $${cost30d.toFixed(2)} of AI spend over the ` +
          `trailing 30 days (alert threshold ` +
          `$${AI_SPEND_ALERT_THRESHOLD_USD}). No enforcement has happened — ` +
          `this is the watch signal. Per-user breakdown: /ops AI usage.`
      );
    }
  } catch (error) {
    console.error('[ai-spend-guard] alert check failed', error);
  }
}
