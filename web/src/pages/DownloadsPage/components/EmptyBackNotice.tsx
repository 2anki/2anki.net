import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

export type EmptyBackSource = 'upload' | 'notion';

interface EmptyBackNoticeProps {
  count: number;
  multipleDecks?: boolean;
  source?: EmptyBackSource;
}

export function EmptyBackNotice({
  count,
  multipleDecks = false,
  source = 'upload',
}: Readonly<EmptyBackNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('empty_back_notice_shown', { empty_back_count: count });
  }, [count]);

  const notionKey = 'emptyBack.notion';
  const uploadKey = multipleDecks
    ? 'emptyBack.uploadMultiDeck'
    : 'emptyBack.uploadSingleDeck';
  const key = source === 'notion' ? notionKey : uploadKey;

  return <p>{t(key, { count })}</p>;
}
