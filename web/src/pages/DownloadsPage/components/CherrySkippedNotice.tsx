import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { trackNoticeOncePerLoad } from '../../../lib/analytics/trackNoticeOncePerLoad';

interface CherrySkippedNoticeProps {
  count: number;
  returnTo?: '/downloads' | '/upload';
  noticeKey?: string;
}

export function CherrySkippedNotice({
  count,
  returnTo = '/downloads',
  noticeKey,
}: Readonly<CherrySkippedNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    trackNoticeOncePerLoad('cherry_skipped_notice_shown', noticeKey, {
      skipped: count,
      returnTo,
    });
  }, [count, returnTo, noticeKey]);

  return (
    <p>
      {t('cherrySkipped.count', { count })}{' '}
      <Link to={`/card-options?returnTo=${returnTo}`}>
        {t('cherrySkipped.link')}
      </Link>
    </p>
  );
}
