import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

export type EmptyBackSource = 'upload' | 'notion' | 'blank' | 'leftOut';

interface EmptyBackNoticeProps {
  count: number;
  multipleDecks?: boolean;
  source?: EmptyBackSource;
  surface?: 'downloads_row';
  noticeKey?: string;
}

const shownThisLoad = new Set<string>();

export function forgetShownEmptyBackNotices(): void {
  shownThisLoad.clear();
}

function alreadyShownThisLoad(
  noticeKey: string | undefined,
  source: EmptyBackSource
): boolean {
  if (noticeKey == null) return false;
  const key = `${noticeKey}:${source}`;
  if (shownThisLoad.has(key)) return true;
  shownThisLoad.add(key);
  return false;
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
    if (alreadyShownThisLoad(noticeKey, source)) return;
    track('empty_back_notice_shown', {
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
