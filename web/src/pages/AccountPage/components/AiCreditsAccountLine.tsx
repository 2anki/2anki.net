import { useTranslation } from 'react-i18next';
import { useAiCredits } from '../../../lib/hooks/useAiCredits';
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
      ? new Date(credits.windowEnd).toLocaleDateString(i18n.language, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
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
