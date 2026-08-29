import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';
import styles from '../DownloadsPage.module.css';

interface NotionEmptyToggleNoticeProps {
  skipped: number;
  cards: number;
  onSeeReport: () => void;
}

/**
 * Shown under a done Notion row when the empty toggles equal or outnumber the
 * cards made — the case where "only N cards" is the truth and the fix is on
 * the user's page, not ours. Renders only for cards >= 1: a zero-card Notion
 * conversion is a failed row, not a done one.
 */
export function NotionEmptyToggleNotice({
  skipped,
  cards,
  onSeeReport,
}: Readonly<NotionEmptyToggleNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('empty_back_notice_shown', {
      empty_back_count: skipped,
      surface: 'downloads_notion',
    });
  }, [skipped]);

  return (
    <div className={styles.emptyToggleNotice}>
      <p className={styles.emptyToggleText}>
        {t('emptyToggleRow.notice', { count: cards, skipped })}
      </p>
      <button type="button" className={styles.reportLink} onClick={onSeeReport}>
        {t('emptyToggleRow.seeReport')}
      </button>
    </div>
  );
}

export function shouldShowEmptyToggleNotice(
  skipped: number,
  cards: number
): boolean {
  return skipped > 0 && cards > 0 && skipped >= cards;
}
