import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { FREE_MONTHLY_CARDS } from '../../pages/LimitPage/LimitWall';
import styles from './AnonymousPartialNotice.module.css';

interface AnonymousPartialNoticeProps {
  readonly cardCount: number;
  readonly cardsHeldBack: number;
}

export function AnonymousPartialNotice({
  cardCount,
  cardsHeldBack,
}: AnonymousPartialNoticeProps) {
  const { t } = useTranslation('anonymousPartial');
  const headingRef = useRef<HTMLParagraphElement>(null);
  const shownFiredRef = useRef(false);

  useEffect(() => {
    if (shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('anonymous_partial_notice_shown', {
      cards_held_back: cardsHeldBack,
    });
    headingRef.current?.focus();
  }, [cardsHeldBack]);

  return (
    <section className={styles.card} role="status" aria-label={t('aria')}>
      <p className={styles.headline} tabIndex={-1} ref={headingRef}>
        {t('headline')}
      </p>
      <p className={styles.heldBack}>
        {t('heldBack', { count: cardsHeldBack })}
      </p>
      <p className={styles.body}>
        {t('body', {
          total: cardCount + cardsHeldBack,
          monthly: FREE_MONTHLY_CARDS,
        })}
      </p>
      <Link
        className={styles.cta}
        to="/register?redirect=/upload"
        onClick={() =>
          track('anonymous_partial_signup_clicked', {
            cards_held_back: cardsHeldBack,
          })
        }
      >
        {t('cta')}
      </Link>
    </section>
  );
}
