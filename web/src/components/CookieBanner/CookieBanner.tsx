import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  CONSENT_CHANGE_EVENT,
  needsBanner,
  setConsent,
} from '../../lib/consent/consent';
import styles from './CookieBanner.module.css';

/**
 * Shown once to visitors the server placed in the EEA/UK/CH until they pick.
 * Both choices carry equal weight; "Only necessary" keeps the site working
 * and leaves analytics in cookieless mode, ads and Hotjar off.
 */
export function CookieBanner() {
  const { t } = useTranslation('consent');
  const [open, setOpen] = useState<boolean>(() => needsBanner());

  useEffect(() => {
    const refresh = () => setOpen(needsBanner());
    globalThis.addEventListener(CONSENT_CHANGE_EVENT, refresh);
    return () => globalThis.removeEventListener(CONSENT_CHANGE_EVENT, refresh);
  }, []);

  if (!open) {
    return null;
  }

  return (
    <section
      className={styles.banner}
      role="region"
      aria-label={t('title')}
      data-testid="cookie-banner"
    >
      <div className={styles.text}>
        <p className={styles.title}>{t('title')}</p>
        <p className={styles.body}>
          {t('body')}{' '}
          <Link to="/documentation/reference/privacy" className={styles.link}>
            {t('privacyLink')}
          </Link>
        </p>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => setConsent('denied')}
        >
          {t('onlyNecessary')}
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() => setConsent('granted')}
        >
          {t('acceptAll')}
        </button>
      </div>
    </section>
  );
}
