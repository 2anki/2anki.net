import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

interface ColorFlattenedNoticeProps {
  count: number;
  multipleDecks?: boolean;
}

export function ColorFlattenedNotice({
  count,
  multipleDecks = false,
}: Readonly<ColorFlattenedNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('color_flatten_notice_shown', { colored_text_page_count: count });
  }, [count]);

  const key = multipleDecks
    ? 'colorFlattened.uploadMultiDeck'
    : 'colorFlattened.uploadSingleDeck';

  return <p>{t(key, { count })}</p>;
}
