import crypto from 'node:crypto';
import { Request, Response } from 'express';
import {
  IErrorEventRepository,
  ErrorEventInsert,
} from '../data_layer/ErrorEventRepository';
import { stripeAccessErrorType } from '../lib/misc/isStripeAccessError';
import { redactStripeIds } from '../lib/log/redactStripeIds';
import { getDefaultEmailService } from './EmailService/EmailService';
import { SUPPORT_CC_ADDRESS } from '../lib/constants';
import { track } from './events/track';

export type StripeAccessErrorReporter = (
  err: Error,
  req: Request,
  res: Response
) => Promise<void>;

// One hour matches the conversion-stall ops alert: long enough that a key
// misconfiguration retried by several users pages ops once, short enough that
// a problem still unresolved an hour later re-pages.
const DEDUP_WINDOW_MS = 60 * 60_000;

// A Stripe access error is a key-level fault that hits every caller, so the
// error_events row is deduped on the message alone rather than per client IP.
// A constant surrogate ip_hash makes the existing message+ip dedup collapse
// all callers into one group, and keeps the real IP out of the row.
const IP_SURROGATE_HASH = crypto
  .createHash('sha256')
  .update('stripe-access-error')
  .digest('hex');

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface StripeAccessErrorReporterDeps {
  sendAlert?: (subject: string, body: string) => Promise<void>;
  windowMs?: number;
}

function defaultSendAlert(subject: string, body: string): Promise<void> {
  return getDefaultEmailService().sendAiSpendAlertEmail(
    SUPPORT_CC_ADDRESS,
    subject,
    body
  );
}

/**
 * Records a Stripe authentication/permission failure as a sanitized
 * error_events row and emails ops the first time it is seen within the dedup
 * window. The row carries only the error type and the request path — never the
 * API key, the Stripe object ids, or the raw Stripe message, any of which would
 * leak a secret into the ops dashboard (CWE-532). Never throws: a failure here
 * must not mask the original error on its way to ErrorHandler.
 */
export const makeStripeAccessErrorReporter = (
  repository: IErrorEventRepository,
  release: string | null = null,
  deps: StripeAccessErrorReporterDeps = {}
): StripeAccessErrorReporter => {
  const windowMs = deps.windowMs ?? DEDUP_WINDOW_MS;
  const sendAlert = deps.sendAlert ?? defaultSendAlert;

  return async (err: Error, req: Request, res: Response): Promise<void> => {
    const type = stripeAccessErrorType(err) ?? 'StripeError';
    const path =
      req.originalUrl == null
        ? null
        : redactStripeIds(req.originalUrl.split('?')[0]);
    const message = `Stripe access denied: ${type}`;
    const messageHash = sha256(message);
    const userId =
      typeof res.locals.owner === 'number' ? res.locals.owner : null;

    try {
      const alreadyAlerted = await repository.existsWithinWindow(
        messageHash,
        IP_SURROGATE_HASH,
        windowMs
      );
      if (alreadyAlerted) {
        return;
      }
      const row: ErrorEventInsert = {
        source: 'server',
        message_hash: messageHash,
        message,
        stack: null,
        url: path,
        release,
        ip_hash: IP_SURROGATE_HASH,
        user_id: userId,
        context: { stripe_error_type: type },
      };
      await repository.insert(row);
    } catch (recordError) {
      console.error(
        '[stripe-access] failed to record access error; skipping alert',
        recordError
      );
      return;
    }

    try {
      track('stripe_access_alert_sent', {
        userId,
        props: { stripe_error_type: type },
      });
      await sendAlert(
        `[2anki] Stripe access error: ${type}`,
        `A Stripe API request was denied with ${type}. The configured ` +
          `Stripe key is invalid, revoked, or missing a permission this ` +
          `request needs. Request path: ${path ?? 'unknown'}. Repeats ` +
          `within the next hour are suppressed. Check the restricted key's ` +
          `permissions in the Stripe dashboard; if the key was rotated or ` +
          `revoked, update the server's Stripe secret. Details on the /ops ` +
          `error dashboard.`
      );
    } catch (alertError) {
      console.error('[stripe-access] alert failed', alertError);
    }
  };
};
