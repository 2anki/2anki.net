import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

export type EmptyBackSource = 'upload' | 'notion' | 'blank';

interface EmptyBackNoticeProps {
  count: number;
  multipleDecks?: boolean;
  source?: EmptyBackSource;
  surface?: 'downloads_row';
}

export function EmptyBackNotice({
  count,
  multipleDecks = false,
  source = 'upload',
  surface,
}: Readonly<EmptyBackNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('empty_back_notice_shown', {
      empty_back_count: count,
      ...(surface != null ? { surface } : {}),
      ...(source === 'blank' ? { kind: 'blank_back' } : {}),
    });
  }, [count, surface, source]);

  const notionKey = 'emptyBack.notion';
  const uploadKey = multipleDecks
    ? 'emptyBack.uploadMultiDeck'
    : 'emptyBack.uploadSingleDeck';
  const keyBySource: Record<EmptyBackSource, string> = {
    upload: uploadKey,
    notion: notionKey,
    blank: 'emptyBack.blankBacks',
  };
  const key = keyBySource[source];

  return <p>{t(key, { count })}</p>;
}
