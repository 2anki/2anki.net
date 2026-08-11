import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import styles from './CreateAccountNotice.module.css';

const SURFACE = 'upload_success_signup';

export function CreateAccountNotice() {
  const { t } = useTranslation('account');
  const shownFiredRef = useRef(false);

  useEffect(() => {
    if (shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('account_offer_shown', { surface: SURFACE });
  }, []);

  return (
    <section className={styles.card} aria-label={t('createAccount.aria')}>
      <p className={styles.headline}>{t('createAccount.headline')}</p>
      <p className={styles.body}>{t('createAccount.body')}</p>
      <Link
        className={styles.cta}
        to="/register?redirect=/upload"
        onClick={() => track('account_offer_clicked', { surface: SURFACE })}
      >
        {t('createAccount.cta')}
      </Link>
    </section>
  );
}
