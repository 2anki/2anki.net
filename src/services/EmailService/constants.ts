import path from 'path';
import fs from 'fs';
import * as os from 'os';

export const EMAIL_TEMPLATES_DIRECTORY = path.join(__dirname, 'templates');

export const PASSWORD_RESET_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'reset.html'),
  'utf8'
);

export const CONVERT_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'convert.html'),
  'utf8'
);

export const CONVERT_LINK_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'convert-link.html'),
  'utf8'
);

export const DEFAULT_SENDER = '2anki.net <info@2anki.net>';

export const SUBSCRIPTION_CANCELLED_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'subscription-cancelled.html'),
  'utf8'
);

export const SUBSCRIPTION_CANCELLATIONS_LOG_PATH = path.join(
  os.homedir(),
  '.2anki',
  'subscriptions-cancelled-sent.json'
);

export const SUBSCRIPTION_SCHEDULED_CANCELLATION_TEMPLATE = fs.readFileSync(
  path.join(
    EMAIL_TEMPLATES_DIRECTORY,
    'subscription-scheduled-cancellation.html'
  ),
  'utf8'
);

export const SUBSCRIPTION_RESUMING_SOON_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'subscription-resuming-soon.html'),
  'utf8'
);

export const MAGIC_LINK_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'magic-link.html'),
  'utf8'
);

export const RE_ENGAGEMENT_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 're-engagement.html'),
  'utf8'
);

export const INACTIVITY_WARNING_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'inactivity-warning.html'),
  'utf8'
);

export const ABANDONED_CHECKOUT_RECOVERY_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'abandoned-checkout-recovery.html'),
  'utf8'
);

export const PASS_WINBACK_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'pass-winback.html'),
  'utf8'
);

export const NOTION_RECONNECT_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'notion-reconnect.html'),
  'utf8'
);

export const PRICE_LOCK_IN_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'price-lock-in.html'),
  'utf8'
);

export const CONTACT_CONFIRMATION_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'contact-confirmation.html'),
  'utf8'
);

export const SUBSCRIPTION_CLAIM_CONFIRMATION_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'subscription-claim-confirmation.html'),
  'utf8'
);

export const PASS_CLAIM_CONFIRMATION_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'pass-claim-confirmation.html'),
  'utf8'
);

export const ANONYMOUS_PASS_CLAIM_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'anonymous-pass-claim.html'),
  'utf8'
);

export const SUBSCRIPTION_RECOVERY_TEMPLATE = fs.readFileSync(
  path.join(EMAIL_TEMPLATES_DIRECTORY, 'subscription-recovery.html'),
  'utf8'
);

export const EMAIL_CATEGORIES = {
  passwordReset: 'password-reset',
  deckReady: 'deck-ready',
  deckReadyLink: 'deck-ready-link',
  contactForm: 'contact-form',
  autoSyncAccessRequest: 'auto-sync-access-request',
  magicLink: 'magic-link',
  reEngagement: 're-engagement',
  inactivityWarning: 'inactivity-warning',
  abandonedCheckoutRecovery: 'abandoned-checkout-recovery',
  passWinback: 'pass-winback',
  subscriptionClaim: 'subscription-claim',
  contactConfirmation: 'contact-confirmation',
  passClaim: 'pass-claim',
  anonymousPassClaim: 'anonymous-pass-claim',
  subscriptionCancelled: 'subscription-cancelled',
  subscriptionScheduledCancellation: 'subscription-scheduled-cancellation',
  subscriptionResumingSoon: 'resuming-soon',
  parserCanary: 'parser-canary',
  notionReconnect: 'notion-reconnect',
  priceLockIn: 'price-lock-in',
  subscriptionRecovery: 'subscription-recovery',
} as const;
