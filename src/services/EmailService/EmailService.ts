import sgMail = require('@sendgrid/mail');
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

import {
  ABANDONED_CHECKOUT_RECOVERY_TEMPLATE,
  API_USAGE_WARNING_TEMPLATE,
  CONVERT_LINK_TEMPLATE,
  CONVERT_TEMPLATE,
  DEFAULT_SENDER,
  INACTIVITY_WARNING_TEMPLATE,
  MAGIC_LINK_TEMPLATE,
  NOTION_RECONNECT_TEMPLATE,
  PASS_WINBACK_TEMPLATE,
  PASSWORD_RESET_TEMPLATE,
  PRICE_LOCK_IN_TEMPLATE,
  RE_ENGAGEMENT_TEMPLATE,
  SUBSCRIPTION_CANCELLED_TEMPLATE,
  SUBSCRIPTION_CANCELLATIONS_LOG_PATH,
  SUBSCRIPTION_CLAIM_CONFIRMATION_TEMPLATE,
  PASS_CLAIM_CONFIRMATION_TEMPLATE,
  SUBSCRIPTION_RECOVERY_TEMPLATE,
  SUBSCRIPTION_SCHEDULED_CANCELLATION_TEMPLATE,
  SUBSCRIPTION_RESUMING_SOON_TEMPLATE,
} from './constants';
import { isValidDeckName, addDeckNameSuffix } from '../../lib/anki/format';
import { escapeHtml } from '../../lib/notion-render/escape';
import { ClientResponse } from '@sendgrid/mail';
import { SUPPORT_CC_ADDRESS, SUPPORT_EMAIL_ADDRESS } from '../../lib/constants';
import { emailHash } from '../../lib/emailHash';
import { getDatabase } from '../../data_layer';
import { sendWithRetry } from './sendWithRetry';
import SuppressionEventsRepository from '../../data_layer/SuppressionEventsRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import { DeckReadyStrings, getEmailStrings } from './i18n';

type EmailResponse = { didSend: boolean; error?: Error };

export type MagicLinkSendResult = { suppressed: boolean };

export interface IEmailService {
  sendResetEmail(email: string, token: string): Promise<void>;
  sendConversionEmail(
    email: string,
    filename: string,
    contents: Buffer,
    cardCount?: number
  ): Promise<[ClientResponse, {}] | null> | void;
  sendConversionLinkEmail(
    email: string,
    filename: string,
    link: string,
    cardCount?: number
  ): void;
  sendContactEmail(
    name: string,
    email: string,
    message: string,
    attachments: Express.Multer.File[]
  ): Promise<EmailResponse>;
  sendSubscriptionCancelledEmail(
    email: string,
    name: string,
    subscriptionId: string
  ): Promise<void>;
  sendSubscriptionScheduledCancellationEmail(
    email: string,
    name: string,
    cancelDate: Date
  ): Promise<void>;
  sendSubscriptionResumingSoonEmail(
    email: string,
    resumeDate: Date,
    amount: string
  ): Promise<void>;
  sendHostedAnkiAccessRequestEmail(
    userId: string,
    userEmail: string
  ): Promise<EmailResponse>;
  sendApiUsageWarningEmail(
    email: string,
    cardsUsed: number,
    limit: number,
    tierKey: string
  ): Promise<void>;
  sendMagicLinkEmail(
    email: string,
    token: string,
    purpose: 'login' | 'password_reset'
  ): Promise<MagicLinkSendResult>;
  sendReEngagementEmail(to: string, name: string, token: string): Promise<void>;
  sendInactivityWarningEmail(
    to: string,
    token: string,
    lastConversion?: { deckName: string } | null
  ): Promise<void>;
  sendAbandonedCheckoutRecoveryEmail(to: string, token: string): Promise<void>;
  sendPassWinbackEmail(to: string, token: string): Promise<void>;
  sendParserCanaryAlert(to: string, summary: string): Promise<void>;
  sendNotionReconnectEmail(email: string): Promise<void>;
  sendSubscriptionClaimConfirmation(
    to: string,
    claimUrl: string
  ): Promise<void>;
  sendPassClaimConfirmation(
    to: string,
    claimUrl: string,
    passKindLabel: string
  ): Promise<void>;
  sendPriceLockInEmail(
    to: string,
    token: string,
    variant: 'a' | 'b'
  ): Promise<void>;
  sendSubscriptionRecoveryEmail(to: string, paidEmail: string): Promise<void>;
}

export const SUBSCRIPTION_RECOVERY_SUBJECT =
  "Your 2anki payment isn't linked to an account yet";

export const PRICE_LOCK_IN_SUBJECTS: Record<'a' | 'b', string> = {
  a: 'Lock in $6/month before prices go up',
  b: 'Your current rate is grandfathered until Sunday',
};

type SgMessage = Exclude<Parameters<typeof sgMail.send>[0], unknown[]>;
type IsEmailSuppressed = (email: string) => Promise<boolean>;
type GetRecipientLanguage = (email: string) => Promise<string | null>;

const THIN_SPACE = ' ';

function formatCardCount(count: number, strings: DeckReadyStrings): string {
  const label = count === 1 ? strings.cardSingular : strings.cardPlural;
  const grouped =
    count >= 10000
      ? String(count).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
      : String(count);
  return `${grouped} ${label}`;
}

function deckReadySuffix(
  cardCount: number | undefined,
  strings: DeckReadyStrings
): string {
  return cardCount == null ? '' : ` — ${formatCardCount(cardCount, strings)}`;
}

function resolveDeckName(filename: string): string {
  const trimmed = filename.trim();
  return trimmed === '' ? 'Untitled deck' : trimmed;
}

function renderDeckReadyMarkup(
  template: string,
  deckName: string,
  cardCount: number | undefined,
  strings: DeckReadyStrings
): string {
  return template
    .replace('{{heading}}', strings.heading)
    .replace('{{bodyAttached}}', strings.bodyAttached)
    .replace('{{bodyTrouble}}', strings.bodyTrouble)
    .replace('{{disclaimerPrefix}}', strings.disclaimerPrefix)
    .replace('{{disclaimerSuffix}}', strings.disclaimerSuffix)
    .replace('{{deckName}}', escapeHtml(deckName))
    .replace('{{cardCountSuffix}}', deckReadySuffix(cardCount, strings));
}

function deckReadyText(
  deckName: string,
  cardCount: number | undefined,
  strings: DeckReadyStrings
): string {
  return `${strings.textReadyPrefix}${deckName}${deckReadySuffix(cardCount, strings)}`;
}

function firstRecipient(to: SgMessage['to']): string | null {
  if (typeof to === 'string') {
    return to;
  }
  if (Array.isArray(to)) {
    const first = to[0];
    return typeof first === 'string' ? first : (first?.email ?? null);
  }
  return to?.email ?? null;
}

export class EmailService implements IEmailService {
  constructor(
    apiKey: string,
    readonly defaultSender: string,
    private readonly isEmailSuppressed: IsEmailSuppressed = async () => false,
    private readonly getRecipientLanguage: GetRecipientLanguage = async () =>
      null
  ) {
    sgMail.setApiKey(apiKey);
  }

  private async resolveLanguage(email: string): Promise<string | null> {
    try {
      return await this.getRecipientLanguage(email);
    } catch {
      return null;
    }
  }

  private async deliver(msg: SgMessage): Promise<[ClientResponse, {}] | null> {
    const recipient = firstRecipient(msg.to);
    if (recipient != null) {
      let suppressed = false;
      try {
        suppressed = await this.isEmailSuppressed(recipient);
      } catch {
        console.error('[email] suppression lookup failed, sending anyway', {
          recipient_hash: emailHash(recipient),
        });
      }
      if (suppressed) {
        console.info('email.send.suppressed', {
          recipient_hash: emailHash(recipient),
        });
        return null;
      }
    }
    return sgMail.send(msg);
  }

  async sendResetEmail(email: string, token: string): Promise<void> {
    const link = `${process.env.DOMAIN ?? 'https://2anki.net'}/users/r/${token}`;
    const strings = getEmailStrings(
      await this.resolveLanguage(email)
    ).resetPassword;
    const markup = PASSWORD_RESET_TEMPLATE.replace(
      '{{heading}}',
      strings.heading
    )
      .replace('{{body}}', strings.body)
      .replace('{{cta}}', strings.cta)
      .replace('{{disclaimer}}', strings.disclaimer)
      .replace('{{link}}', link);
    const msg = {
      to: email,
      from: this.defaultSender,
      subject: strings.subject,
      text: strings.text.replace('{{link}}', link),
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await this.deliver(msg);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw error;
    }
  }

  async sendConversionEmail(
    email: string,
    filename: string,
    contents: Buffer,
    cardCount?: number
  ): Promise<[ClientResponse, {}] | null> {
    const strings = getEmailStrings(
      await this.resolveLanguage(email)
    ).deckReady;
    const deckName = resolveDeckName(filename);
    const markup = renderDeckReadyMarkup(
      CONVERT_TEMPLATE,
      deckName,
      cardCount,
      strings
    );

    let attachedFilename = filename;
    if (!isValidDeckName(filename)) {
      attachedFilename = addDeckNameSuffix(filename);
    }
    const msg = {
      to: email,
      from: DEFAULT_SENDER,
      subject: strings.subject.replace('{{filename}}', filename),
      text: `${deckReadyText(deckName, cardCount, strings)}${strings.textAttached}`,
      html: markup,
      replyTo: 'support@2anki.net',
      attachments: [
        {
          content: contents.toString('base64'),
          filename: attachedFilename,
          type: 'application/apkg',
          disposition: 'attachment',
        },
      ],
    };

    return this.deliver(msg);
  }

  async sendConversionLinkEmail(
    email: string,
    filename: string,
    link: string,
    cardCount?: number
  ) {
    const strings = getEmailStrings('en').deckReady;
    const deckName = resolveDeckName(filename);
    const markup = renderDeckReadyMarkup(
      CONVERT_LINK_TEMPLATE,
      deckName,
      cardCount,
      strings
    ).replace(/{{link}}/g, link);
    const msg = {
      to: email,
      from: DEFAULT_SENDER,
      subject: `2anki.net - Your «${filename}» deck is ready`,
      text: `${deckReadyText(deckName, cardCount, strings)}. Download it here: ${link}`,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    await this.deliver(msg);
  }

  async sendContactEmail(
    name: string,
    email: string,
    message: string,
    attachments: Express.Multer.File[]
  ): Promise<EmailResponse> {
    const msg = {
      to: SUPPORT_EMAIL_ADDRESS,
      cc: SUPPORT_CC_ADDRESS,
      from: DEFAULT_SENDER,
      replyTo: email,
      subject: `Contact form submission on behalf of ${
        name ?? 'Anon'
      } <${email}>`,
      text: `Message: ${message}\n\n`,
      attachments: attachments.map((file) => ({
        content: file.buffer.toString('base64'),
        filename: file.originalname,
        type: file.mimetype,
        disposition: 'attachment',
      })),
    };
    try {
      await sendWithRetry(() => sgMail.send(msg));
      return { didSend: true };
    } catch (e) {
      console.error('Error sending email', e);
      return { didSend: false, error: e as Error };
    }
  }

  async sendHostedAnkiAccessRequestEmail(
    userId: string,
    userEmail: string
  ): Promise<EmailResponse> {
    const msg = {
      to: SUPPORT_EMAIL_ADDRESS,
      cc: SUPPORT_CC_ADDRESS,
      from: DEFAULT_SENDER,
      subject: 'Auto Sync access request',
      text: `User ${userId} <${userEmail}> requested access to Auto Sync.`,
      replyTo: userEmail,
    };
    try {
      await sgMail.send(msg);
      return { didSend: true };
    } catch (e) {
      console.error('Error sending Auto Sync access request email', e);
      return { didSend: false, error: e as Error };
    }
  }

  async sendMagicLinkEmail(
    email: string,
    token: string,
    purpose: 'login' | 'password_reset'
  ): Promise<MagicLinkSendResult> {
    const link = `${process.env.DOMAIN ?? 'https://2anki.net'}/auth/magic?token=${token}`;
    const isLogin = purpose === 'login';
    const strings = getEmailStrings(await this.resolveLanguage(email));
    const variant = isLogin ? strings.magicLinkLogin : strings.magicLinkReset;
    const shared = strings.magicLinkShared;

    const markup = MAGIC_LINK_TEMPLATE.replace('{{title}}', variant.heading)
      .replace('{{heading}}', variant.heading)
      .replace('{{description}}', variant.description)
      .replace('{{link}}', link)
      .replace('{{buttonText}}', variant.cta)
      .replace('{{expiry}}', shared.expiry)
      .replace('{{disclaimer}}', shared.disclaimer);

    const plainText = variant.text.replace('{{link}}', link);

    const msg = {
      to: email,
      from: this.defaultSender,
      subject: variant.subject,
      text: plainText,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      const result = await this.deliver(msg);
      return { suppressed: result == null };
    } catch (error) {
      console.error('Failed to send magic link email:', error);
      throw error;
    }
  }

  async sendReEngagementEmail(
    to: string,
    name: string,
    token: string
  ): Promise<void> {
    const domain = process.env.DOMAIN ?? 'https://2anki.net';
    const surveyUrl = `${domain}/feedback/onboarding?uid=${token}`;
    const unsubscribeUrl = `${domain}/unsubscribe?uid=${token}`;
    const strings = getEmailStrings(await this.resolveLanguage(to));
    const copy = strings.reEngagement;
    const markup = RE_ENGAGEMENT_TEMPLATE.replace('{{title}}', copy.title)
      .replace('{{heading}}', copy.heading)
      .replace('{{body}}', copy.body)
      .replace('{{videoCaption}}', copy.videoCaption)
      .replace('{{bodyPaste}}', copy.bodyPaste)
      .replace('{{bodyReply}}', copy.bodyReply)
      .replace('{{cta}}', copy.cta)
      .replace('{{unsubscribe}}', strings.commercialShared.unsubscribe)
      .replaceAll('{{name}}', name)
      .replaceAll('{{surveyUrl}}', surveyUrl)
      .replaceAll('{{unsubscribeUrl}}', unsubscribeUrl);

    const msg = {
      to,
      from: this.defaultSender,
      subject: copy.subject,
      text: copy.text
        .replaceAll('{{name}}', name)
        .replaceAll('{{surveyUrl}}', surveyUrl),
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      console.error('Failed to send re-engagement email:', error);
      throw error;
    }
  }

  async sendInactivityWarningEmail(
    to: string,
    token: string,
    lastConversion?: { deckName: string } | null
  ): Promise<void> {
    const domain = process.env.DOMAIN ?? 'https://2anki.net';
    const strings = getEmailStrings(await this.resolveLanguage(to));
    const copy = strings.inactivityWarning;

    const hasConversion = lastConversion != null;
    const bodyText = hasConversion
      ? copy.bodyWithConversion.replace(
          '{{deckName}}',
          () => lastConversion.deckName
        )
      : copy.bodyNoConversion;

    const ctaUrl = `${domain}/r/email?t=${encodeURIComponent(token)}&c=inactivity&to=/upload`;
    const unsubscribeUrl = `${domain}/unsubscribe?uid=${token}`;

    const markup = INACTIVITY_WARNING_TEMPLATE.replace('{{title}}', copy.title)
      .replace('{{bodyText}}', () => bodyText)
      .replace('{{passLine}}', copy.passLine)
      .replace('{{cta}}', copy.cta)
      .replace('{{housekeeping}}', copy.housekeeping)
      .replace('{{signoff}}', copy.signoff)
      .replace('{{unsubscribe}}', strings.commercialShared.unsubscribe)
      .replace('{{ctaUrl}}', ctaUrl)
      .replace('{{unsubscribeUrl}}', unsubscribeUrl);

    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const msg = {
      to,
      from: this.defaultSender,
      subject: copy.subject,
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      console.error(`Failed to send inactivity warning to ${to}:`, error);
      throw error;
    }
  }

  async sendAbandonedCheckoutRecoveryEmail(
    to: string,
    token: string
  ): Promise<void> {
    const domain = process.env.DOMAIN ?? 'https://2anki.net';
    const link = `${domain}/checkout/resume?token=${encodeURIComponent(token)}`;
    const unsubscribeUrl = `${domain}/unsubscribe?uid=${token}`;
    const strings = getEmailStrings(await this.resolveLanguage(to));
    const copy = strings.abandonedCheckout;
    const markup = ABANDONED_CHECKOUT_RECOVERY_TEMPLATE.replace(
      '{{title}}',
      copy.title
    )
      .replace('{{bodyStarted}}', copy.bodyStarted)
      .replace('{{bodySnag}}', copy.bodySnag)
      .replace('{{cta}}', copy.cta)
      .replace('{{signoff}}', copy.signoff)
      .replace('{{unsubscribe}}', strings.commercialShared.unsubscribe)
      .replace('{{link}}', () => link)
      .replace('{{unsubscribeUrl}}', unsubscribeUrl);
    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const msg = {
      to,
      from: this.defaultSender,
      subject: copy.subject,
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };
    try {
      await sgMail.send(msg);
    } catch (error) {
      console.error(
        `Failed to send abandoned-checkout recovery to ${to}:`,
        error
      );
      throw error;
    }
  }

  async sendPassWinbackEmail(to: string, token: string): Promise<void> {
    const domain = process.env.DOMAIN ?? 'https://2anki.net';
    const ctaUrl = `${domain}/r/email?t=${encodeURIComponent(token)}&c=pass_winback&to=/pricing`;
    const unsubscribeUrl = `${domain}/unsubscribe?uid=${token}`;
    const markup = PASS_WINBACK_TEMPLATE.replace('{{ctaUrl}}', ctaUrl).replace(
      '{{unsubscribeUrl}}',
      unsubscribeUrl
    );
    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const msg = {
      to,
      from: this.defaultSender,
      subject: 'Back for another exam? Pick up a 2anki pass',
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };
    try {
      await sgMail.send(msg);
    } catch (error) {
      console.error(`Failed to send pass win-back to ${to}:`, error);
      throw error;
    }
  }

  async sendSubscriptionClaimConfirmation(
    to: string,
    claimUrl: string
  ): Promise<void> {
    const markup = SUBSCRIPTION_CLAIM_CONFIRMATION_TEMPLATE.replace(
      '{{link}}',
      claimUrl
    );
    const msg = {
      to,
      from: this.defaultSender,
      subject: 'Confirm your 2anki subscription claim',
      text: `Confirm your subscription claim here: ${claimUrl} — this link expires in 15 minutes.`,
      html: markup,
      replyTo: 'support@2anki.net',
    };
    try {
      await this.deliver(msg);
    } catch (error) {
      console.error(
        'Failed to send subscription claim confirmation email:',
        error
      );
      throw error;
    }
  }

  async sendPassClaimConfirmation(
    to: string,
    claimUrl: string,
    passKindLabel: string
  ): Promise<void> {
    const markup = PASS_CLAIM_CONFIRMATION_TEMPLATE.replace(
      '{{link}}',
      claimUrl
    ).replace('{{passKind}}', passKindLabel);
    const msg = {
      to,
      from: this.defaultSender,
      subject: 'Confirm your 2anki pass claim',
      text: `Confirm your pass claim here: ${claimUrl} — this link expires in 15 minutes.`,
      html: markup,
      replyTo: 'support@2anki.net',
    };
    try {
      await this.deliver(msg);
    } catch (error) {
      console.error('Failed to send pass claim confirmation email:', error);
      throw error;
    }
  }

  private loadCancellationsSent(): Set<string> {
    try {
      // Ensure .2anki directory exists
      const dir = path.dirname(SUBSCRIPTION_CANCELLATIONS_LOG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(SUBSCRIPTION_CANCELLATIONS_LOG_PATH)) {
        const data = fs.readFileSync(
          SUBSCRIPTION_CANCELLATIONS_LOG_PATH,
          'utf8'
        );
        return new Set(JSON.parse(data));
      }
    } catch (error) {
      console.warn('Error loading cancellations log:', error);
    }
    return new Set();
  }

  private saveCancellationSent(subscriptionId: string): void {
    try {
      const cancellationsSent = this.loadCancellationsSent();
      cancellationsSent.add(subscriptionId);
      fs.writeFileSync(
        SUBSCRIPTION_CANCELLATIONS_LOG_PATH,
        JSON.stringify([...cancellationsSent])
      );
    } catch (error) {
      console.error('Error saving cancellation log:', error);
    }
  }

  async sendSubscriptionCancelledEmail(
    email: string,
    name: string,
    subscriptionId: string
  ): Promise<void> {
    const cancellationsSent = this.loadCancellationsSent();
    if (cancellationsSent.has(subscriptionId)) {
      console.log(
        `Skipping ${email} - Cancellation notification already sent for subscription ${subscriptionId}`
      );
      return;
    }

    const markup = SUBSCRIPTION_CANCELLED_TEMPLATE.replace(
      '{{name}}',
      name || 'there'
    );

    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const msg = {
      to: email,
      from: this.defaultSender,
      subject: '2anki.net - Subscription Cancelled',
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await this.deliver(msg);
      this.saveCancellationSent(subscriptionId);
      console.log(`Successfully sent cancellation confirmation to ${email}`);
    } catch (error) {
      console.error(
        `Failed to send cancellation confirmation to ${email}:`,
        error
      );
      throw error;
    }
  }

  async sendSubscriptionScheduledCancellationEmail(
    email: string,
    name: string,
    cancelDate: Date
  ): Promise<void> {
    const formattedDate = cancelDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const markup = SUBSCRIPTION_SCHEDULED_CANCELLATION_TEMPLATE.replace(
      '{{name}}',
      name || 'there'
    ).replace(/{{cancelDate}}/g, formattedDate);

    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const msg = {
      to: email,
      from: this.defaultSender,
      subject: '2anki.net - Subscription Cancellation Scheduled',
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await this.deliver(msg);
      console.log(
        `Successfully sent scheduled cancellation notification to ${email}`
      );
    } catch (error) {
      console.error(
        `Failed to send scheduled cancellation notification to ${email}:`,
        error
      );
      throw error;
    }
  }

  async sendSubscriptionResumingSoonEmail(
    email: string,
    resumeDate: Date,
    amount: string
  ): Promise<void> {
    const formattedDate = resumeDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const markup = SUBSCRIPTION_RESUMING_SOON_TEMPLATE.replace(
      /{{resumeDate}}/g,
      formattedDate
    ).replace(/{{amount}}/g, amount);

    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const msg = {
      to: email,
      from: this.defaultSender,
      subject: `Your 2anki subscription resumes on ${formattedDate}`,
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await this.deliver(msg);
      console.log(`Successfully sent resume warning to ${emailHash(email)}`);
    } catch (error) {
      console.error(
        `Failed to send resume warning to ${emailHash(email)}:`,
        error
      );
      throw error;
    }
  }

  async sendParserCanaryAlert(to: string, summary: string): Promise<void> {
    const msg = {
      to,
      cc: SUPPORT_CC_ADDRESS,
      from: this.defaultSender,
      subject: '[2anki] Parser canary failure — fixture count mismatch',
      text: summary,
      replyTo: 'support@2anki.net',
    };
    try {
      await sgMail.send(msg);
    } catch (error) {
      console.error('[parser-canary] failed to send alert email:', error);
      throw error;
    }
  }

  async sendApiUsageWarningEmail(
    email: string,
    cardsUsed: number,
    limit: number,
    tierKey: string
  ): Promise<void> {
    const groupDigits = (value: number) =>
      value >= 10000
        ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
        : String(value);
    const markup = API_USAGE_WARNING_TEMPLATE.replace(
      '{{cardsUsed}}',
      groupDigits(cardsUsed)
    )
      .replace('{{limit}}', groupDigits(limit))
      .replace('{{tier}}', tierKey);
    const msg = {
      to: email,
      from: this.defaultSender,
      subject: `API usage: ${cardsUsed} of ${limit} cards this month`,
      text: `Your API usage is at ${cardsUsed} of ${limit} cards this month on the ${tierKey} tier. Conversions stop at the limit and resume when it resets on the 1st. Manage your plan at https://2anki.net/developers`,
      html: markup,
      replyTo: 'support@2anki.net',
    };
    try {
      await this.deliver(msg);
    } catch (error) {
      console.error('[api-usage] failed to send usage warning email:', error);
    }
  }

  async sendNotionReconnectEmail(email: string): Promise<void> {
    const ctaUrl = `${process.env.DOMAIN ?? 'https://2anki.net'}/notion`;
    const markup = NOTION_RECONNECT_TEMPLATE.replace('{{ctaUrl}}', ctaUrl);
    const msg = {
      to: email,
      from: this.defaultSender,
      subject: 'Your Notion connection expired',
      text: `2anki lost access to your Notion workspace and can no longer convert your pages. Reconnect at ${ctaUrl}`,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await this.deliver(msg);
    } catch (error) {
      console.error(
        '[notion-reconnect] failed to send reconnect email:',
        error
      );
      throw error;
    }
  }

  async sendPriceLockInEmail(
    to: string,
    token: string,
    variant: 'a' | 'b'
  ): Promise<void> {
    const domain = process.env.DOMAIN ?? 'https://2anki.net';
    const ctaUrl = `${domain}/r/email?t=${encodeURIComponent(token)}&c=price_lock_in&to=/pricing`;
    const unsubscribeUrl = `${domain}/unsubscribe?uid=${token}`;
    const markup = PRICE_LOCK_IN_TEMPLATE.replace('{{ctaUrl}}', ctaUrl).replace(
      '{{unsubscribeUrl}}',
      unsubscribeUrl
    );

    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const msg = {
      to,
      from: this.defaultSender,
      subject: PRICE_LOCK_IN_SUBJECTS[variant],
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await this.deliver(msg);
    } catch (error) {
      console.error(`Failed to send price lock-in email to ${to}:`, error);
      throw error;
    }
  }

  async sendSubscriptionRecoveryEmail(
    to: string,
    paidEmail: string
  ): Promise<void> {
    const domain = process.env.DOMAIN ?? 'https://2anki.net';
    const registerUrl = `${domain}/register?email=${encodeURIComponent(paidEmail)}`;
    const accountUrl = `${domain}/account`;

    const markup = SUBSCRIPTION_RECOVERY_TEMPLATE.replaceAll(
      '{{paidEmail}}',
      paidEmail
    )
      .replaceAll('{{registerUrl}}', registerUrl)
      .replaceAll('{{accountUrl}}', accountUrl);

    const $ = cheerio.load(markup);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const msg = {
      to,
      from: this.defaultSender,
      subject: SUBSCRIPTION_RECOVERY_SUBJECT,
      text,
      html: markup,
      replyTo: 'support@2anki.net',
    };

    try {
      await this.deliver(msg);
    } catch (error) {
      console.error(
        `Failed to send subscription recovery email to ${emailHash(to)}:`,
        error
      );
      throw error;
    }
  }
}

export class UnimplementedEmailService implements IEmailService {
  async sendResetEmail(email: string, token: string): Promise<void> {
    console.info('sendResetEmail not handled', email, token);
  }

  sendConversionEmail(
    email: string,
    filename: string,
    contents: Buffer,
    cardCount?: number
  ): void {
    console.info(
      'sendConversionEmail not handled',
      email,
      filename,
      contents,
      cardCount
    );
  }

  sendConversionLinkEmail(
    email: string,
    filename: string,
    link: string,
    cardCount?: number
  ): void {
    console.info(
      'sendConversionLinkEmail not handled',
      email,
      filename,
      link,
      cardCount
    );
  }

  sendContactEmail(
    name: string,
    email: string,
    message: string,
    attachments: Express.Multer.File[]
  ): Promise<EmailResponse> {
    console.info('sendContactEmail not handled');
    return Promise.resolve({ didSend: false });
  }

  sendSubscriptionCancelledEmail(
    email: string,
    name: string,
    subscriptionId: string
  ): Promise<void> {
    console.info(
      'sendSubscriptionCancelledEmail not handled',
      email,
      name,
      subscriptionId
    );
    return Promise.resolve();
  }

  sendSubscriptionScheduledCancellationEmail(
    email: string,
    name: string,
    cancelDate: Date
  ): Promise<void> {
    console.info(
      'sendSubscriptionScheduledCancellationEmail not handled',
      email,
      name,
      cancelDate
    );
    return Promise.resolve();
  }

  sendSubscriptionResumingSoonEmail(
    email: string,
    resumeDate: Date,
    amount: string
  ): Promise<void> {
    console.info(
      'sendSubscriptionResumingSoonEmail not handled',
      email,
      resumeDate,
      amount
    );
    return Promise.resolve();
  }

  sendHostedAnkiAccessRequestEmail(
    userId: string,
    userEmail: string
  ): Promise<EmailResponse> {
    console.info(
      'sendHostedAnkiAccessRequestEmail not handled',
      userId,
      userEmail
    );
    return Promise.resolve({ didSend: false });
  }

  async sendMagicLinkEmail(
    email: string,
    token: string,
    purpose: 'login' | 'password_reset'
  ): Promise<MagicLinkSendResult> {
    console.info('sendMagicLinkEmail not handled');
    return { suppressed: false };
  }

  async sendReEngagementEmail(
    to: string,
    name: string,
    token: string
  ): Promise<void> {
    console.info('sendReEngagementEmail not handled', to, name, token);
  }

  async sendInactivityWarningEmail(
    to: string,
    token: string,
    lastConversion?: { deckName: string } | null
  ): Promise<void> {
    console.info(
      'sendInactivityWarningEmail not handled',
      to,
      token,
      lastConversion
    );
  }

  async sendAbandonedCheckoutRecoveryEmail(
    to: string,
    token: string
  ): Promise<void> {
    console.info('sendAbandonedCheckoutRecoveryEmail not handled', to, token);
  }

  async sendPassWinbackEmail(to: string, token: string): Promise<void> {
    console.info('sendPassWinbackEmail not handled', to, token);
  }

  async sendParserCanaryAlert(to: string, summary: string): Promise<void> {
    console.info('sendParserCanaryAlert not handled', to, summary);
  }

  async sendApiUsageWarningEmail(
    email: string,
    cardsUsed: number,
    limit: number,
    tierKey: string
  ): Promise<void> {
    console.info(
      'sendApiUsageWarningEmail not handled',
      email,
      cardsUsed,
      limit,
      tierKey
    );
  }

  async sendNotionReconnectEmail(email: string): Promise<void> {
    console.info('sendNotionReconnectEmail not handled', email);
  }

  async sendSubscriptionClaimConfirmation(
    _to: string,
    _claimUrl: string
  ): Promise<void> {
    console.info('sendSubscriptionClaimConfirmation not handled');
  }

  async sendPassClaimConfirmation(
    _to: string,
    _claimUrl: string,
    _passKindLabel: string
  ): Promise<void> {
    console.info('sendPassClaimConfirmation not handled');
  }

  async sendPriceLockInEmail(
    to: string,
    token: string,
    variant: 'a' | 'b'
  ): Promise<void> {
    console.info('sendPriceLockInEmail not handled', to, token, variant);
  }

  async sendSubscriptionRecoveryEmail(
    to: string,
    paidEmail: string
  ): Promise<void> {
    console.info('sendSubscriptionRecoveryEmail not handled', to, paidEmail);
  }
}

export const getDefaultEmailService = () => {
  if (process.env.SENDGRID_API_KEY !== undefined) {
    const database = getDatabase();
    const suppressionRepository = new SuppressionEventsRepository(database);
    const usersRepository = new UsersRepository(database);
    return new EmailService(
      process.env.SENDGRID_API_KEY!,
      DEFAULT_SENDER,
      (email) => suppressionRepository.isSuppressed(emailHash(email)),
      (email) => usersRepository.getLanguageByEmail(email)
    );
  }
  return new UnimplementedEmailService();
};
