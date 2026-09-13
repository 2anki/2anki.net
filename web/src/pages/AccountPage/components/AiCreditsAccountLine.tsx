import { useTranslation } from 'react-i18next';
import { useAiCredits } from '../../../lib/hooks/useAiCredits';
import { formatLongDate } from '../utils/formatLongDate';
import styles from '../AccountPage.module.css';

export function AiCreditsAccountLine() {
  const { t, i18n } = useTranslation('aicredits');
  const credits = useAiCredits(true);

  if (credits == null || credits.loading || credits.allowance === 0) {
    return null;
  }

  if (credits.credits <= 0) {
    return <p className={styles.planMeta}>{t('planZero')}</p>;
  }

  const validThrough =
    credits.windowEnd != null
      ? // The window end is a UTC-midnight boundary; format it in UTC so a user
        // west of UTC does not see the reset date a day early.
        formatLongDate(new Date(credits.windowEnd), i18n.language, 'UTC')
      : null;

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
