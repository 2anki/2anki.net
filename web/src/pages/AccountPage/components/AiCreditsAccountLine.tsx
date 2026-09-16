import { useTranslation } from 'react-i18next';
import { useAiCredits } from '../../../lib/hooks/useAiCredits';
import { formatLongDate } from '../utils/formatLongDate';
import styles from '../AccountPage.module.css';

export function AiCreditsAccountLine() {
  const { t, i18n } = useTranslation('aicredits');
  const credits = useAiCredits(true);

  if (credits == null || credits.allowance === 0) {
    return null;
  }

  if (credits.credits <= 0) {
    return <p className={styles.planMeta}>{t('planZero')}</p>;
  }

  // Only the calendar-month window ends on a UTC-midnight boundary, so format
  // that one in UTC to avoid a day-early reset west of UTC. The period and pass
  // windows carry the exact Stripe/pass timestamp, which is rendered in the
  // user's local time.
  const timeZone = credits.resets === 'month' ? 'UTC' : undefined;
  const validThrough =
    credits.windowEnd != null
      ? formatLongDate(new Date(credits.windowEnd), i18n.language, timeZone)
      : null;

  if (credits.used > 0) {
    return (
      <p className={styles.planMeta}>
        <span className={styles.aiCreditsCount}>
          {t('usedThisPeriod', { count: credits.used })}
        </span>{' '}
        {validThrough != null
          ? t('remainingValid', { count: credits.credits, date: validThrough })
          : t('remaining', { count: credits.credits })}
      </p>
    );
  }

  return (
    <p className={styles.planMeta}>
      <span className={styles.aiCreditsCount}>
        {validThrough != null
          ? t('planValid', {
              count: credits.credits,
              date: validThrough,
            })
          : t('plan', { count: credits.credits })}
      </span>
    </p>
  );
}
