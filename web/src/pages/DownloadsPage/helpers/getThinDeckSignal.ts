import JobResponse from '../../../schemas/public/JobResponse';
import { parseForbiddenBlocksPayload } from './parseForbiddenBlocksPayload';
import { parseUnsupportedBlocksPayload } from './parseUnsupportedBlocksPayload';
import { countUnsupportedBlocks } from './countUnsupportedBlocks';

export type ThinDeckReason = 'emptyToggles' | 'notConnected' | 'generic';

export interface ThinDeckSignal {
  candidateSkips: number;
  reason: ThinDeckReason;
}

function dominantReason(
  emptyToggles: number,
  notConnected: number,
  unsupported: number
): ThinDeckReason {
  if (emptyToggles > notConnected && emptyToggles > unsupported) {
    return 'emptyToggles';
  }
  if (notConnected > emptyToggles && notConnected > unsupported) {
    return 'notConnected';
  }
  return 'generic';
}

export function getThinDeckSignal(job: JobResponse): ThinDeckSignal {
  const emptyToggles = job.empty_back_count ?? 0;
  const notConnected = parseForbiddenBlocksPayload(job)?.count ?? 0;
  const unsupportedBlocks = parseUnsupportedBlocksPayload(job);
  const unsupported =
    unsupportedBlocks == null ? 0 : countUnsupportedBlocks(unsupportedBlocks);

  return {
    candidateSkips: emptyToggles + notConnected + unsupported,
    reason: dominantReason(emptyToggles, notConnected, unsupported),
  };
}
