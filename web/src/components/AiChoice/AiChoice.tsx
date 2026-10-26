import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './AiChoice.module.css';

interface AiChoiceProps {
  aiOn: boolean;
  onChange: (next: boolean) => void;
}

export function AiChoice({ aiOn, onChange }: Readonly<AiChoiceProps>) {
  const { t } = useTranslation('aiPreview');
  const groupName = useId();
  const consentId = useId();

  return (
    <fieldset className={styles.choice}>
      <legend className={styles.legend}>{t('choiceLegend')}</legend>
      <div className={styles.options}>
        <label className={styles.option}>
          <input
            type="radio"
            name={groupName}
            checked={!aiOn}
            onChange={() => onChange(false)}
          />
          <span>{t('choiceStructure')}</span>
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name={groupName}
            checked={aiOn}
            aria-describedby={consentId}
            onChange={() => onChange(true)}
          />
          <span>{t('choiceClaude')}</span>
        </label>
      </div>
      <p id={consentId} className={styles.consent}>
        {t('choiceConsent')}{' '}
        <a href="/documentation/reference/privacy">{t('choicePrivacy')}</a>
      </p>
    </fieldset>
  );
}
