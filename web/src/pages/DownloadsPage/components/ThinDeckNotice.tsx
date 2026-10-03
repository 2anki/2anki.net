import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';
import styles from '../DownloadsPage.module.css';
import { ThinDeckReason } from '../helpers/getThinDeckSignal';

type ThinDeckSurface = 'downloads' | 'upload';

interface ThinDeckNoticeProps {
  reason: ThinDeckReason;
  cards: number;
  skipped: number;
  surface?: ThinDeckSurface;
  onSeeReport?: () => void;
}

export function ThinDeckNotice({
  reason,
  cards,
  skipped,
  surface = 'downloads',
  onSeeReport,
}: Readonly<ThinDeckNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('thin_deck_notice_shown', { reason, cards, skipped, surface });
  }, [reason, cards, skipped, surface]);

  return (
    <div className={styles.emptyToggleNotice}>
      <p className={styles.emptyToggleText}>
        {t(`thinDeck.${reason}`, { count: cards, skipped })}
      </p>
      {onSeeReport && (
        <button
          type="button"
          className={`${styles.reportLink} ${styles.thinDeckSeeReport}`}
          aria-haspopup="dialog"
          onClick={onSeeReport}
        >
          {t('thinDeck.seeReport')}
        </button>
      )}
    </div>
  );
}

export function shouldShowThinDeckNotice(
  candidateSkips: number,
  cards: number
): boolean {
  return cards >= 1 && candidateSkips >= cards && candidateSkips >= 2;
}
