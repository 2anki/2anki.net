import express from 'express';

import { getDatabase } from '../data_layer';
import InactivityEmailRepository from '../data_layer/InactivityEmailRepository';
import PassWinbackRepository from '../data_layer/PassWinbackRepository';
import PriceLockInEmailRepository from '../data_layer/PriceLockInEmailRepository';
import ReEngagementRepository from '../data_layer/ReEngagementRepository';
import { getEventsSink } from '../services/events/eventsSinkInstance';

// Keyed by the value that may appear in ?to=, valued by the path we redirect to.
// A Set + `has()` guard was equally safe at runtime, but the redirect still
// forwarded the caller's own string, so Sonar's taint engine could not tell an
// open redirect from a checked one (tssecurity:S5146, reported BLOCKER). Looking
// the value up here means the string handed to res.redirect is always one of
// ours, never the caller's — the taint chain ends at the lookup instead of
// needing a False Positive marking in the SonarCloud UI.
// A Map, not an object literal: an object would resolve inherited keys, so
// `?to=toString` would hand back Object.prototype.toString and interpolate a
// function into the redirect URL. A Map has no inherited entries.
const EMAIL_DESTINATIONS = new Map<string, string>([
  ['/', '/'],
  ['/upload', '/upload'],
  ['/pricing', '/pricing'],
  ['/login', '/login'],
]);

const DEFAULT_EMAIL_DESTINATION = '/';

export function resolveEmailDestination(requested: string | null): string {
  if (requested == null) return DEFAULT_EMAIL_DESTINATION;
  return EMAIL_DESTINATIONS.get(requested) ?? DEFAULT_EMAIL_DESTINATION;
}

const EmailRedirectRouter = () => {
  const router = express.Router();

  /**
   * @swagger
   * /r/email:
   *   get:
   *     summary: Email click redirect
   *     description: |
   *       Records an `email_clicked` analytics event then 302s the user to a
   *       validated destination. Destination is checked against a static
   *       allowlist (`/`, `/upload`, `/pricing`, `/login`); unknown values fall
   *       back to `/`. Unknown or missing tokens record an anonymous click and
   *       still redirect — never fails user-visibly.
   *     tags: [Email]
   *     parameters:
   *       - in: query
   *         name: t
   *         schema:
   *           type: string
   *         description: Email token from inactivity_emails.token or re_engagement_emails.token
   *       - in: query
   *         name: c
   *         schema:
   *           type: string
   *           enum: [inactivity, reengagement]
   *         description: Campaign — disambiguates which table to resolve the token against
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *         description: Destination path (allowlisted); falls back to `/` if unknown
   *     responses:
   *       302:
   *         description: Redirect to the resolved destination
   */
  router.get('/r/email', async (req, res) => {
    const token = typeof req.query.t === 'string' ? req.query.t : null;
    const campaign = typeof req.query.c === 'string' ? req.query.c : null;
    const rawDestination =
      typeof req.query.to === 'string' ? req.query.to : null;

    const destination = resolveEmailDestination(rawDestination);

    const domain = process.env.DOMAIN ?? 'https://2anki.net';
    const sink = getEventsSink();

    let userId: number | null = null;
    let emailId: number | null = null;

    if (token != null && campaign != null) {
      const database = getDatabase();

      if (campaign === 'inactivity') {
        const result = await new InactivityEmailRepository(database)
          .findByToken(token)
          .catch(() => null);
        if (result != null) {
          userId = result.userId;
          emailId = result.id;
        }
      } else if (campaign === 'reengagement') {
        const result = await new ReEngagementRepository(database)
          .findByToken(token)
          .catch(() => null);
        if (result != null) {
          userId = result.userId;
          emailId = result.id;
        }
      } else if (campaign === 'price_lock_in') {
        const result = await new PriceLockInEmailRepository(database)
          .findByToken(token)
          .catch(() => null);
        if (result != null) {
          userId = result.userId;
          emailId = result.id;
        }
      } else if (campaign === 'pass_winback') {
        const result = await new PassWinbackRepository(database)
          .findByToken(token)
          .catch(() => null);
        if (result != null) {
          userId = result.userId;
          emailId = result.id;
        }
      }
    }

    sink.record({
      name: 'email_clicked',
      user_id: userId,
      props: {
        campaign: campaign ?? 'unknown',
        email_id: emailId,
        destination,
      },
    });

    res.redirect(302, `${domain}${destination}`);
  });

  return router;
};

export default EmailRedirectRouter;
