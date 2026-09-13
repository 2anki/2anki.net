import { useTranslation } from 'react-i18next';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';
import pageStyles from '../UploadPage.module.css';

const LOW_CREDITS_THRESHOLD = 25;

interface Props {
  readonly credits: AiCreditsState | null;
}

export function AiCreditsReadout({ credits }: Props) {
  const { t } = useTranslation('aicredits');

  if (credits == null || credits.loading) {
    return null;
  }

  if (credits.credits <= 0) {
    return (
      <span className={pageStyles.aiCreditsLine} data-testid="ai-credits">
        <span className={pageStyles.aiCreditsWarning}>{t('zero')}</span>
      </span>
    );
  }

  const low = credits.credits <= LOW_CREDITS_THRESHOLD;
  return (
    <span className={pageStyles.aiCreditsLine} data-testid="ai-credits">
      <span
        className={
          low ? pageStyles.aiCreditsWarning : pageStyles.aiCreditsCount
        }
      >
        {t('left', { count: credits.credits })}
      </span>
    </span>
  );
}
