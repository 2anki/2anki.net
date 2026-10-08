import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

type ImageDropSource = 'notion' | 'upload' | 'pdf' | 'notionHtml';

type ImageDropSurface = 'upload_form' | 'downloads_row';

interface ImageDropNoticeProps {
  count: number;
  source?: ImageDropSource;
  multipleDecks?: boolean;
  expiredCount?: number;
  surface?: ImageDropSurface;
}

function resolveImageDropKey(
  source: ImageDropSource,
  multipleDecks: boolean
): string {
  if (source === 'notionHtml') return 'imageDrop.notionHtmlUpload';
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
  expiredCount,
  surface = 'upload_form',
}: Readonly<ImageDropNoticeProps>) {
  const { t } = useTranslation('downloadsx');
  const expired = expiredCount ?? 0;

  useEffect(() => {
    track('image_drop_notice_shown', {
      dropped_count: count,
      source,
      expired_count: expired,
      surface,
      reason: source === 'notionHtml' ? 'notion_html_no_folder' : null,
    });
  }, [count, source, expired, surface]);

  const expiredNoticeKey = multipleDecks
    ? 'imageDrop.notionExportExpiredMultiDeck'
    : 'imageDrop.notionExportExpired';
  const key =
    expired > 0 && expired >= count
      ? expiredNoticeKey
      : resolveImageDropKey(source, multipleDecks);

  return <p>{t(key, { count })}</p>;
}
