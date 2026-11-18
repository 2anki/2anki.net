import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import styles from './CreateAccountNotice.module.css';

const SURFACE = 'upload_success_signup';

interface CreateAccountNoticeProps {
  readonly deckName?: string;
  readonly secondary?: boolean;
  readonly keptForAccount?: boolean;
}

function noticeKeys(keptForAccount: boolean) {
  if (keptForAccount) {
    return {
      headline: 'createAccount.keptHeadline',
      body: 'createAccount.keptBody',
      bodyNoName: 'createAccount.keptBodyNoName',
    };
  }
  return {
    headline: 'createAccount.headline',
    body: 'createAccount.body',
    bodyNoName: 'createAccount.bodyNoName',
  };
}

export function CreateAccountNotice({
  deckName,
  secondary = false,
  keptForAccount = false,
}: CreateAccountNoticeProps) {
  const { t } = useTranslation('account');
  const shownFiredRef = useRef(false);

  useEffect(() => {
    if (shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('account_offer_shown', { surface: SURFACE });
  }, []);

  const hasDeckName = deckName != null && deckName.length > 0;
  const keys = noticeKeys(keptForAccount);

  return (
    <section className={styles.card} aria-label={t('createAccount.aria')}>
      <p className={styles.headline}>{t(keys.headline)}</p>
      <p className={styles.body} data-hj-suppress>
        {hasDeckName ? t(keys.body, { deckName }) : t(keys.bodyNoName)}
      </p>
      <Link
        className={
          secondary ? `${styles.cta} ${styles.ctaSecondary}` : styles.cta
        }
        to="/register?redirect=/upload"
        onClick={() => track('account_offer_clicked', { surface: SURFACE })}
      >
        {t('createAccount.cta')}
      </Link>
    </section>
  );
}
