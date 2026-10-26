import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../lib/analytics/track';
import { useStripeSubscriptions } from '../../lib/hooks/useStripeSubscriptions';
import { STRIPE_CUSTOMER_PORTAL_URL } from '../../lib/stripePortal';
import sharedStyles from '../../styles/shared.module.css';
import styles from './PastDueNotice.module.css';

// A failed renewal ends Pro at once, so the person lands on a limit wall with
// no idea why. This says why and how to get Pro back, ahead of any offer to
// buy something new.
export function PastDueNotice({
  surface,
  enabled = true,
}: Readonly<{ surface: string; enabled?: boolean }>) {
  const { t } = useTranslation('account');
  const { view } = useStripeSubscriptions(enabled);
  const pastDue = view.kind === 'past_due' ? view.subscription : null;
  const trackedRef = useRef<string | null>(null);

  useEffect(() => {
    if (pastDue == null || trackedRef.current === pastDue.id) return;
    trackedRef.current = pastDue.id;
    track('subscription_past_due_shown', {
      subscription_id: pastDue.id,
      surface,
    });
  }, [pastDue, surface]);

  if (pastDue == null) return null;

  return (
    <div className={styles.notice} role="status">
      <p className={styles.title}>{t('subscription.pastDueTitle')}</p>
      <p className={styles.body}>{t('subscription.pastDueAccessPaused')}</p>
      <a
        className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
        href={STRIPE_CUSTOMER_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          track('subscription_manage_billing_clicked', {
            from: 'past_due',
            surface,
          })
        }
      >
        {t('subscription.updatePayment')}
      </a>
      <p className={styles.help}>{t('subscription.updatePaymentHelp')}</p>
    </div>
  );
}
