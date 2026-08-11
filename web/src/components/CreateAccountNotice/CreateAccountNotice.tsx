import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import styles from './CreateAccountNotice.module.css';

const SURFACE = 'upload_success_signup';

interface CreateAccountNoticeProps {
  readonly deckName?: string;
}

export function CreateAccountNotice({ deckName }: CreateAccountNoticeProps) {
  const { t } = useTranslation('account');
  const shownFiredRef = useRef(false);

  useEffect(() => {
    if (shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('account_offer_shown', { surface: SURFACE });
  }, []);

  const hasDeckName = deckName != null && deckName.length > 0;

  return (
    <section className={styles.card} aria-label={t('createAccount.aria')}>
      <p className={styles.headline}>{t('createAccount.headline')}</p>
      <p className={styles.body} data-hj-suppress>
        {hasDeckName
          ? t('createAccount.body', { deckName })
          : t('createAccount.bodyNoName')}
      </p>
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
