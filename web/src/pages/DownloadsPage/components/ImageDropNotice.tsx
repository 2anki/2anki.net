import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

type ImageDropSource = 'notion' | 'upload' | 'pdf';

interface ImageDropNoticeProps {
  count: number;
  source?: ImageDropSource;
  multipleDecks?: boolean;
}

function resolveImageDropKey(
  source: ImageDropSource,
  multipleDecks: boolean
): string {
  if (source === 'pdf') return 'imageDrop.pdf';
  if (source === 'upload') {
    return multipleDecks
      ? 'imageDrop.uploadMultiDeck'
      : 'imageDrop.uploadSingleDeck';
  }
  return 'imageDrop.notion';
}

export function ImageDropNotice({
  count,
  source = 'notion',
  multipleDecks = false,
}: Readonly<ImageDropNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('image_drop_notice_shown', { dropped_count: count, source });
  }, [count, source]);

  const key = resolveImageDropKey(source, multipleDecks);

  return <p>{t(key, { count })}</p>;
}
