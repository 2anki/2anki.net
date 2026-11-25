import { useTranslation } from 'react-i18next';
import styles from './AiGiftUploadCard.module.css';

export type UploadMode = 'notion' | 'ai';

interface Props {
  mode: UploadMode;
  onChange: (mode: UploadMode) => void;
}

export function UploadModeSwitch({ mode, onChange }: Readonly<Props>) {
  const { t } = useTranslation('aiGift');
  return (
    <div
      className={styles.modeSwitch}
      role="group"
      aria-label={t('card.modeLabel')}
    >
      <button
        type="button"
        className={styles.modeOption}
        aria-pressed={mode === 'notion'}
        onClick={() => onChange('notion')}
      >
        {t('card.modeNotion')}
      </button>
      <button
        type="button"
        className={styles.modeOption}
        aria-pressed={mode === 'ai'}
        onClick={() => onChange('ai')}
      >
        {t('card.modeAi')}
        <span className={styles.freePill}>{t('card.free')}</span>
      </button>
    </div>
  );
}
