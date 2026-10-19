import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';

type ImageDropSource =
  | 'notion'
  | 'notionAsset'
  | 'upload'
  | 'pdf'
  | 'notionHtml'
  | 'plainText';

type ImageDropSurface = 'upload_form' | 'downloads_row';

function reasonForImageDropSource(source: ImageDropSource): string | null {
  if (source === 'notionHtml') return 'notion_html_no_folder';
  if (source === 'plainText') return 'plain_text_fallback';
  return null;
}

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
  if (source === 'notionAsset') return 'imageDrop.notionAsset';
  if (source === 'plainText') return 'imageDrop.plainTextFallback';
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
      reason: reasonForImageDropSource(source),
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
