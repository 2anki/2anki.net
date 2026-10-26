import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { track } from '../../../lib/analytics/track';

interface CherrySkippedNoticeProps {
  count: number;
}

export function CherrySkippedNotice({
  count,
}: Readonly<CherrySkippedNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('cherry_skipped_notice_shown', { skipped: count });
  }, [count]);

  return (
    <p>
      {t('cherrySkipped.count', { count })}{' '}
      <Link to="/card-options?returnTo=/downloads">
        {t('cherrySkipped.link')}
      </Link>
    </p>
  );
}
