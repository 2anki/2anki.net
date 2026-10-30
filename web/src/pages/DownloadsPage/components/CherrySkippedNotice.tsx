import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { track } from '../../../lib/analytics/track';

interface CherrySkippedNoticeProps {
  count: number;
  returnTo?: '/downloads' | '/upload';
}

export function CherrySkippedNotice({
  count,
  returnTo = '/downloads',
}: Readonly<CherrySkippedNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('cherry_skipped_notice_shown', { skipped: count, returnTo });
  }, [count, returnTo]);

  return (
    <p>
      {t('cherrySkipped.count', { count })}{' '}
      <Link to={`/card-options?returnTo=${returnTo}`}>
        {t('cherrySkipped.link')}
      </Link>
    </p>
  );
}
