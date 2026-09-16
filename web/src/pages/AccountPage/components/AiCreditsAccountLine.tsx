import { useTranslation } from 'react-i18next';
import { useAiCredits } from '../../../lib/hooks/useAiCredits';
import { BuyCreditsButton } from '../../../components/BuyCreditsButton/BuyCreditsButton';
import { formatLongDate } from '../../../lib/formatLongDate';
import styles from '../AccountPage.module.css';

export function AiCreditsAccountLine() {
  const { t, i18n } = useTranslation('aicredits');
  const credits = useAiCredits(true);

  if (credits == null) {
    return null;
  }

  if (!credits.usable) {
    if (credits.credits > 0 && credits.windowEnd != null) {
      const pausedThrough = formatLongDate(
        new Date(credits.windowEnd),
        i18n.language
      );
      return (
        <p className={styles.planMeta}>
          {t('paused', { count: credits.credits, date: pausedThrough })}
        </p>
      );
    }
    return null;
  }

  if (credits.credits <= 0) {
    return (
      <>
        <p className={styles.planMeta}>{t('planZero')}</p>
        <BuyCreditsButton source="credits_account" variant="secondary" />
      </>
    );
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
    <>
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
      <BuyCreditsButton source="credits_account" variant="secondary" />
    </>
  );
}
