import { useTranslation } from 'react-i18next';
import styles from '../AccountPage.module.css';
import { AiCreditsAccountLine } from './AiCreditsAccountLine';
import { formatLongDate } from '../utils/formatLongDate';
import type { PlanName } from '../hooks/useSubscriptionStatus';

interface PlanDetailsProps {
  readonly plan: PlanName;
  readonly passExpiresAt?: string | null;
}

const PLAN_NAME: Record<Exclude<PlanName, 'free'>, string> = {
  pro: 'Pro',
  autoSync: 'Auto Sync',
  lifetime: 'Lifetime',
  dayPass: 'Day Pass',
  weekPass: 'Week Pass',
  semesterPass: 'Semester Pass',
};

const PLAN_META_KEY: Record<'pro' | 'autoSync' | 'lifetime', string> = {
  pro: 'planDetails.proMeta',
  autoSync: 'planDetails.autoSyncMeta',
  lifetime: 'planDetails.lifetimeMeta',
};

function isDatedPass(
  plan: PlanName
): plan is 'dayPass' | 'weekPass' | 'semesterPass' {
  return plan === 'dayPass' || plan === 'weekPass' || plan === 'semesterPass';
}

export function PlanDetails({ plan, passExpiresAt }: PlanDetailsProps) {
  const { t, i18n } = useTranslation('account');

  if (plan === 'free') {
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

  if (isDatedPass(plan)) {
    return (
      <section className={styles.section}>
        <p className={styles.planTier}>{PLAN_NAME[plan]}</p>
        {passExpiresAt != null && (
          <p className={styles.planMeta}>
            {t('planDetails.passEnds', {
              date: formatLongDate(new Date(passExpiresAt), i18n.language),
            })}
          </p>
        )}
        <AiCreditsAccountLine />
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <p className={styles.planTier}>{PLAN_NAME[plan]}</p>
      <p className={styles.planMeta}>{t(PLAN_META_KEY[plan])}</p>
      <AiCreditsAccountLine />
    </section>
  );
}
