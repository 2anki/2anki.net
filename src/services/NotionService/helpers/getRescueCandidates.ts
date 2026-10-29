import {
  isRescueCandidate,
  type RescueCandidate,
} from '../../../types/RescueCandidate';

function parseStored(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The structures an empty Notion conversion offered, stored on the failed
 * job's conversion_report so the Downloads row can show them with sample
 * cards. Anything malformed or outside the rescue vocabulary is dropped.
 */
export function getRescueCandidates(storedReport: unknown): RescueCandidate[] {
  const parsed = parseStored(storedReport);
  if (typeof parsed !== 'object' || parsed == null) {
    return [];
  }
  const candidates = (parsed as Record<string, unknown>).rescue_candidates;
  if (!Array.isArray(candidates)) {
    return [];
  }
  return candidates.filter(isRescueCandidate);
}
