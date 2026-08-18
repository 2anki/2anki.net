import { useTranslation } from 'react-i18next';

import styles from './Footer.module.css';
import { STRIPE_CUSTOMER_PORTAL_URL } from '../lib/stripePortal';

function Footer() {
  const { t } = useTranslation('marketing');
  const currentYear = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.brandName}>2anki</span>
          <p className={styles.brandTag}>{t('footer.brandTag')}</p>
        </div>
        <div className={styles.group}>
          <span className={styles.groupTitle}>{t('footer.product')}</span>
          <a href="/about">{t('common:nav.about')}</a>
          <a href="/app">{t('footer.iosApp')}</a>
          <a href="/documentation">{t('common:nav.docs')}</a>
          <a href="/pricing">{t('common:nav.pricing')}</a>
          <a href="/contact">{t('common:nav.contact')}</a>
        </div>
        <div className={styles.group}>
          <span className={styles.groupTitle}>{t('footer.legal')}</span>
          <a href="/documentation/misc/terms-of-service">
            {t('common:nav.terms')}
          </a>
          <a href="/documentation/misc/privacy-policy">
            {t('common:nav.privacy')}
          </a>
          <a href="/security">{t('footer.security')}</a>
          <a href={STRIPE_CUSTOMER_PORTAL_URL} rel="noreferrer">
            {t('footer.manageSubscription')}
          </a>
        </div>
      </div>
      <div className={styles.bottom}>
        <span className={styles.copyright}>
          {`© 2020–${currentYear} Alexander Alemayhu`}
        </span>
        <div className={styles.bottomRight}>
          <a
            href="https://github.com/2anki/server"
            target="_blank"
            rel="noreferrer"
            className={styles.githubLink}
            aria-label="GitHub"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
