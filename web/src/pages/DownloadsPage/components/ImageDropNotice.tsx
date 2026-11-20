import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trackNoticeOncePerLoad } from '../../../lib/analytics/trackNoticeOncePerLoad';

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
  noticeKey?: string;
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
  noticeKey,
}: Readonly<ImageDropNoticeProps>) {
  const { t } = useTranslation('downloadsx');
  const expired = expiredCount ?? 0;

  useEffect(() => {
    trackNoticeOncePerLoad('image_drop_notice_shown', noticeKey, {
      dropped_count: count,
      source,
      expired_count: expired,
      surface,
      reason: reasonForImageDropSource(source),
    });
  }, [count, source, expired, surface, noticeKey]);

  const expiredNoticeKey = multipleDecks
    ? 'imageDrop.notionExportExpiredMultiDeck'
    : 'imageDrop.notionExportExpired';
  const key =
    expired > 0 && expired >= count
      ? expiredNoticeKey
      : resolveImageDropKey(source, multipleDecks);

  return <p>{t(key, { count })}</p>;
}
