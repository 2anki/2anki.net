import { GetBlockResponse } from '@notionhq/client/build/src/api-endpoints';

import NotionAPIWrapper from '../NotionAPIWrapper';
import { downloadMediaOrSkip } from './downloadMediaOrSkip';

export type MediaSourceType = 'file' | 'external';

interface FreshUrlRetryParams {
  api: NotionAPIWrapper;
  blockId: string;
  url: string;
  sourceType: MediaSourceType;
  extractFreshUrl: (block: GetBlockResponse) => string | null;
}

async function resolveFreshUrl(
  api: NotionAPIWrapper,
  blockId: string,
  extractFreshUrl: (block: GetBlockResponse) => string | null
): Promise<string | null> {
  try {
    const freshBlock = await api.getBlock(blockId);
    return extractFreshUrl(freshBlock);
  } catch (error) {
    console.warn(
      `Could not re-fetch Notion block ${blockId} for a fresh media URL`,
      error
    );
    return null;
  }
}

function warnSkipped(blockId: string, reason: string): void {
  console.warn(`Skipping media fetch for Notion block ${blockId} — ${reason}`);
}

export async function downloadWithFreshUrlRetry({
  api,
  blockId,
  url,
  sourceType,
  extractFreshUrl,
}: FreshUrlRetryParams): Promise<Buffer | null> {
  const contents = await downloadMediaOrSkip(url);
  if (contents != null) {
    return contents;
  }

  if (sourceType !== 'file') {
    warnSkipped(blockId, 'external media URL returned no content');
    return null;
  }

  const freshUrl = await resolveFreshUrl(api, blockId, extractFreshUrl);
  if (freshUrl == null) {
    warnSkipped(blockId, 'signed URL expired and could not be refreshed');
    return null;
  }

  const refreshed = await downloadMediaOrSkip(freshUrl);
  if (refreshed == null) {
    warnSkipped(blockId, 'signed URL expired and could not be refreshed');
    return null;
  }

  console.info(
    `Recovered Notion media for block ${blockId} after refreshing its expired signed URL`
  );
  return refreshed;
}
