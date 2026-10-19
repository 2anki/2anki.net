import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';
import styles from '../DownloadsPage.module.css';

interface PartialDeckNoticeProps {
  onSeeReport?: () => void;
}

export function PartialDeckNotice({
  onSeeReport,
}: Readonly<PartialDeckNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('partial_deck_notice_shown');
  }, []);

  return (
    <div className={styles.emptyToggleNotice}>
      <p className={styles.emptyToggleText}>{t('partialDeck.notice')}</p>
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

export default PartialDeckNotice;
