import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trackNoticeOncePerLoad } from '../../../lib/analytics/trackNoticeOncePerLoad';

export type EmptyBackSource = 'upload' | 'notion' | 'blank' | 'leftOut';

interface EmptyBackNoticeProps {
  count: number;
  multipleDecks?: boolean;
  source?: EmptyBackSource;
  surface?: 'downloads_row';
  noticeKey?: string;
}

export function EmptyBackNotice({
  count,
  multipleDecks = false,
  source = 'upload',
  surface,
  noticeKey,
}: Readonly<EmptyBackNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    const kindKey = noticeKey == null ? undefined : `${noticeKey}:${source}`;
    trackNoticeOncePerLoad('empty_back_notice_shown', kindKey, {
      empty_back_count: count,
      ...(surface != null ? { surface } : {}),
      ...(source === 'blank' ? { kind: 'blank_back' } : {}),
      ...(source === 'leftOut' ? { kind: 'left_out_at_limit' } : {}),
    });
  }, [count, surface, source, noticeKey]);

  const notionKey = 'emptyBack.notion';
  const uploadKey = multipleDecks
    ? 'emptyBack.uploadMultiDeck'
    : 'emptyBack.uploadSingleDeck';
  const keyBySource: Record<EmptyBackSource, string> = {
    upload: uploadKey,
    notion: notionKey,
    blank: 'emptyBack.blankBacks',
    leftOut: 'emptyBack.leftOutAtLimit',
  };
  const key = keyBySource[source];

  return <p>{t(key, { count })}</p>;
}
