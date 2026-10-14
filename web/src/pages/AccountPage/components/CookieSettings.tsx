import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CONSENT_CHANGE_EVENT,
  getEffectiveConsent,
  setConsent,
  type ConsentChoice,
} from '../../../lib/consent/consent';
import pickerStyles from '../../../components/LanguagePicker/LanguagePicker.module.css';
import styles from './CookieSettings.module.css';

/** The place to change the cookie choice later, for every region. */
export function CookieSettings() {
  const { t } = useTranslation('consent');
  const [choice, setChoice] = useState<ConsentChoice>(() =>
    getEffectiveConsent()
  );

  useEffect(() => {
    const refresh = () => setChoice(getEffectiveConsent());
    globalThis.addEventListener(CONSENT_CHANGE_EVENT, refresh);
    return () => globalThis.removeEventListener(CONSENT_CHANGE_EVENT, refresh);
  }, []);

  return (
    <div className={pickerStyles.labeledRow}>
      <p className={pickerStyles.rowLabel}>{t('settingsTitle')}</p>
      <p className={pickerStyles.rowDescription}>{t('settingsDescription')}</p>
      <p className={styles.status} role="status">
        {choice === 'granted' ? t('statusGranted') : t('statusDenied')}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          aria-pressed={choice === 'granted'}
          onClick={() => setConsent('granted')}
        >
          {t('allow')}
        </button>
        <button
          type="button"
          className={styles.button}
          aria-pressed={choice === 'denied'}
          onClick={() => setConsent('denied')}
        >
          {t('onlyNecessary')}
        </button>
      </div>
    </div>
  );
}
