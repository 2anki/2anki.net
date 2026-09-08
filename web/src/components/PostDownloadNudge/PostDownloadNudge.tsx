import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { useCardUsage } from '../../lib/hooks/useCardUsage';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { isPayingUser } from '../NavigationBar/helpers/getPlanLabel';
import styles from './PostDownloadNudge.module.css';

const SURFACE = 'post_download_nudge';
const FALLBACK_CARD_LIMIT = 100;

interface PostDownloadNudgeProps {
  readonly page: 'upload' | 'downloads';
}

export function PostDownloadNudge({ page }: PostDownloadNudgeProps) {
  const { t } = useTranslation('marketing');
  const { data } = useUserLocals();
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const shownFiredRef = useRef(false);

  const paying = isPayingUser(data?.locals);
  const isAnonymous = data?.user?.email == null;
  const suppress = paying || isAnonymous;

  const cardUsage = useCardUsage(!suppress);
  const limit =
    cardUsage != null && !cardUsage.loading
      ? cardUsage.cards_limit
      : FALLBACK_CARD_LIMIT;

  useEffect(() => {
    if (suppress) return;
    let cancelled = false;
    get2ankiApi()
      .getPitchEligibility()
      .then((result) => {
        if (!cancelled) setEligible(result.postDownloadNudge);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [suppress]);

  useEffect(() => {
    if (suppress || hidden) return;
    if (eligible !== true || shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('paywall_shown', { surface: SURFACE, page });
  }, [suppress, hidden, eligible, page]);

  if (suppress || hidden || eligible !== true) return null;

  const dismiss = () => {
    setHidden(true);
    track('paywall_dismissed', { surface: SURFACE, page });
    get2ankiApi()
      .dismissPitch('post_download_nudge')
      .catch(() => {});
  };

  const ctaClick = () =>
    track('paywall_upgrade_clicked', {
      surface: SURFACE,
      page,
      plan: 'see_plans',
    });

  return (
    <PostDownloadNudgeCard limit={limit} onDismiss={dismiss} onCta={ctaClick} />
  );
}

// Presentational half, exported so the /dev/upload-success-preview route can
// render the card with injected state instead of going through the
// auth+eligibility gate (which renders nothing in a dev context).
interface PostDownloadNudgeCardProps {
  readonly limit: number;
  readonly onDismiss?: () => void;
  readonly onCta?: () => void;
}

export function PostDownloadNudgeCard({
  limit,
  onDismiss,
  onCta,
}: PostDownloadNudgeCardProps) {
  const { t } = useTranslation('marketing');
  return (
    <section className={styles.card} aria-label={t('postDownloadNudge.aria')}>
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label={t('postDownloadNudge.dismiss')}
      >
        ×
      </button>
      <p className={styles.headline}>{t('postDownloadNudge.headline')}</p>
      <p className={styles.body}>{t('postDownloadNudge.body', { limit })}</p>
      <Link
        className={styles.cta}
        to="/pricing?source=post_download_nudge"
        onClick={onCta}
      >
        {t('postDownloadNudge.cta')}
      </Link>
    </section>
  );
}
