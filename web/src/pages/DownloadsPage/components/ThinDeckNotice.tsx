import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trackNoticeOncePerLoad } from '../../../lib/analytics/trackNoticeOncePerLoad';
import styles from '../DownloadsPage.module.css';
import { ThinDeckReason } from '../helpers/getThinDeckSignal';

type ThinDeckSurface = 'downloads' | 'upload';

interface ThinDeckNoticeProps {
  reason: ThinDeckReason;
  cards: number;
  skipped: number;
  surface?: ThinDeckSurface;
  onSeeReport?: () => void;
  noticeKey?: string;
}

export function ThinDeckNotice({
  reason,
  cards,
  skipped,
  surface = 'downloads',
  onSeeReport,
  noticeKey,
}: Readonly<ThinDeckNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    trackNoticeOncePerLoad('thin_deck_notice_shown', noticeKey, {
      reason,
      cards,
      skipped,
      surface,
    });
  }, [reason, cards, skipped, surface, noticeKey]);

  const message = t(`thinDeck.${reason}`, { count: cards, skipped });

  if (surface === 'upload') {
    return <p>{message}</p>;
  }

  return (
    <div className={styles.emptyToggleNotice}>
      <p className={styles.emptyToggleText}>{message}</p>
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
