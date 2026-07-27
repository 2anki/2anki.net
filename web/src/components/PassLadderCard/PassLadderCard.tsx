import { useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { startUnlimitedUpgrade } from '../../lib/backend/startUnlimitedUpgrade';
import styles from './PassLadderCard.module.css';

const SURFACE = 'pass_ladder_success';
const PRICING_HREF = `/pricing?source=${SURFACE}`;

interface PassLadderCardProps {
  readonly offerOverride?: { passCount: number; spentUsd: number };
}

export function PassLadderCard({ offerOverride }: PassLadderCardProps = {}) {
  const { t } = useTranslation('marketing');
  const { data } = useUserLocals();
  const shownFiredRef = useRef(false);
  const offer = offerOverride ?? data?.passLadder;

  useEffect(() => {
    if (offer == null) return;
    if (shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('paywall_shown', {
      surface: SURFACE,
      passes: offer.passCount,
      spent_usd: offer.spentUsd,
    });
  }, [offer]);

  if (offer == null) return null;

  const handleUnlimitedClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    track('paywall_upgrade_clicked', { surface: SURFACE, plan: 'unlimited' });
    await startUnlimitedUpgrade(SURFACE);
  };

  return (
    <section className={styles.card} aria-label={t('passLadder.aria')}>
      <p className={styles.headline}>{t('passLadder.headline')}</p>
      <p className={styles.body}>
        {t('passLadder.body', {
          count: offer.passCount,
          spent: offer.spentUsd,
        })}
      </p>
      <a
        className={styles.cta}
        href={PRICING_HREF}
        onClick={handleUnlimitedClick}
      >
        {t('passLadder.cta')}
      </a>
    </section>
  );
}
