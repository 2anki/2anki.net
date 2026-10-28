import hashToken from '../../lib/misc/hashToken';
import { withServerMarker } from '../../lib/events/serverEventProps';
import type {
  CheckoutRecoveryDetails,
  IAbandonedCheckoutRecoveryRepository,
} from '../../data_layer/AbandonedCheckoutRecoveryRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { EventsSink } from '../../services/events/EventsSink';

const RECENT_SEND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export class SendAbandonedCheckoutRecoveryOnExpiryUseCase {
  constructor(
    private readonly repository: IAbandonedCheckoutRecoveryRepository,
    private readonly emailService: IEmailService,
    private readonly eventsSink?: Pick<EventsSink, 'record'>
  ) {}

  async execute(
    sessionId: string,
    email: string | null,
    recovery: CheckoutRecoveryDetails | null = null
  ): Promise<void> {
    if (email == null) {
      console.warn('checkout.session.expired.no_email', {
        session_id_hash: hashToken(sessionId),
      });
      return;
    }

    console.info('checkout.session.expired.recovery_url', {
      present: recovery != null,
      session_id_hash: hashToken(sessionId),
    });

    const optedOut = await this.repository.isMarketingOptedOut(email);
    if (optedOut) {
      console.info('checkout.session.expired.opted_out', {
        session_id_hash: hashToken(sessionId),
      });
      return;
    }

    const alreadyPaying =
      await this.repository.hasLifetimeOrActiveSubscription(email);
    if (alreadyPaying) {
      console.info('checkout.session.expired.already_paying', {
        session_id_hash: hashToken(sessionId),
      });
      return;
    }

    const cutoff = new Date(Date.now() - RECENT_SEND_WINDOW_MS);
    const recentlySent = await this.repository.hasSendSince(email, cutoff);
    if (recentlySent) {
      console.info('checkout.session.expired.recently_sent', {
        session_id_hash: hashToken(sessionId),
      });
      return;
    }

    const token = crypto.randomUUID();
    const claimed = await this.repository.claimSession(
      sessionId,
      email,
      token,
      recovery
    );
    if (claimed) {
      await this.emailService.sendAbandonedCheckoutRecoveryEmail(email, token);
      console.info('checkout.session.expired.recovery_sent', {
        session_id_hash: hashToken(sessionId),
      });
      this.eventsSink?.record({
        name: 'email_batch_sent',
        props: withServerMarker({ campaign: 'abandoned_checkout', count: 1 }),
      });
    }
  }
}
