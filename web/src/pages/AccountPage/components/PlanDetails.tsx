import { useTranslation } from 'react-i18next';
import styles from '../AccountPage.module.css';
import { AiCreditsAccountLine } from './AiCreditsAccountLine';

interface PlanDetailsProps {
  readonly subscriptionType: 'subscriber' | 'lifetime' | 'free';
}

export function PlanDetails({ subscriptionType }: PlanDetailsProps) {
  const { t } = useTranslation('account');

  if (subscriptionType === 'lifetime') {
    return (
      <section className={styles.section}>
        <p className={styles.planTier}>Lifetime</p>
        <p className={styles.planMeta}>{t('planDetails.lifetimeMeta')}</p>
        <AiCreditsAccountLine />
      </section>
    );
  }

  if (subscriptionType === 'subscriber') {
    return (
      <section className={styles.section}>
        <p className={styles.planTier}>{t('subscription.premium')}</p>
        <p className={styles.planMeta}>{t('planDetails.premiumMeta')}</p>
        <AiCreditsAccountLine />
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <p className={styles.planTier}>{t('planDetails.free')}</p>
      <p className={styles.planMeta}>{t('planDetails.freeMeta')}</p>
      <AiCreditsAccountLine />
      <a href="/pricing" className={styles.primaryButton}>
        {t('planDetails.seePlans')}
      </a>
    </section>
  );
}
