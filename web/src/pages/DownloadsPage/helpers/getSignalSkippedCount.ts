import JobResponse from '../../../schemas/public/JobResponse';
import { parseDroppedAssetsPayload } from './parseDroppedAssetsPayload';
import { parseForbiddenBlocksPayload } from './parseForbiddenBlocksPayload';
import { parseUnsupportedBlocksPayload } from './parseUnsupportedBlocksPayload';
import { countUnsupportedBlocks } from './countUnsupportedBlocks';

/**
 * Count pill for the row-level "Conversion report" link, derived from the
 * legacy single-signal payload the polled jobs list already carries. The
 * stored report (lazy-fetched in the modal) is the authoritative accounting;
 * this only decides whether the pill shows and with which number.
 */
export function getSignalSkippedCount(job: JobResponse): number {
  const droppedAssets = parseDroppedAssetsPayload(job);
  if (droppedAssets != null) {
    return droppedAssets;
  }
  const forbiddenBlocks = parseForbiddenBlocksPayload(job);
  if (forbiddenBlocks != null) {
    return forbiddenBlocks.count;
  }
  const unsupportedBlocks = parseUnsupportedBlocksPayload(job);
  if (unsupportedBlocks != null) {
    return countUnsupportedBlocks(unsupportedBlocks);
  }
  return 0;
}
