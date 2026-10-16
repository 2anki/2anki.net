import sgMail from '@sendgrid/mail';
import { getDatabase } from '../../../../data_layer';
import { DEFAULT_SENDER } from '../../../../services/EmailService/constants';
import SubscriptionService from '../../../../services/SubscriptionService';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const database = getDatabase();

const SUBJECT =
  'Action needed: your 2anki.net subscription is not linked to an account';

const BODY = (email: string) => `Hi,

We noticed that your 2anki.net subscription (${email}) is not linked to any account in our system.

This means you may not be getting the benefits of your subscription. To fix this, please reply to this email or contact us at support@2anki.net — we'll get it sorted out quickly.

If you'd prefer a refund instead, just let us know and we'll process it right away.

We've gone ahead and cancelled your subscription so you won't be charged again while this is unresolved.

Sorry for the inconvenience,

---
Happy learning,
The 2anki Team

https://2anki.net/`;

async function findUnlinkedSubscriptions(): Promise<
  { email: string; linked_email: string | null }[]
> {
  return database('subscriptions')
    .select('email', 'linked_email')
    .where('active', true)
    .whereNotIn('email', database('users').select('email'))
    .where(function () {
      this.whereNull('linked_email').orWhereNotIn(
        'linked_email',
        database('users').select('email')
      );
    });
}

async function cancelAndNotify(email: string): Promise<void> {
  console.info('Processing unlinked subscription row');

  const cancelled = await SubscriptionService.cancelUserSubscriptions(
    email,
    'immediate',
    false,
    false
  );
  if (cancelled.length === 0) {
    console.warn(
      'No active Stripe subscriptions found for this row — skipping email'
    );
    return;
  }

  await sgMail.send({
    to: email,
    from: DEFAULT_SENDER,
    replyTo: 'support@2anki.net',
    subject: SUBJECT,
    text: BODY(email),
  });
  console.info('Cancelled and notified subscriber');
}

async function cancelUnlinkedSubscriptions(): Promise<void> {
  const rows = await findUnlinkedSubscriptions();
  console.info(`Found ${rows.length} unlinked active subscriptions`);

  for (const row of rows) {
    try {
      await cancelAndNotify(row.email);
    } catch (err) {
      console.error('Failed to process unlinked subscription row:', err);
    }
  }

  console.info('Done');
}

if (require.main === module) {
  cancelUnlinkedSubscriptions()
    .catch(console.error)
    .finally(() => database.destroy());
}
