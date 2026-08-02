import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

interface ForbiddenBlocksNoticeProps {
  count: number;
}

export function ForbiddenBlocksNotice({
  count,
}: Readonly<ForbiddenBlocksNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('notion_blocks_forbidden_notice_shown', { count });
  }, [count]);

  return <p>{t('blocksForbidden.notion', { count })}</p>;
}
