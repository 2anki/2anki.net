import { WeightedSemaphore } from '../../lib/rateLimit/WeightedSemaphore';
import { ParseCacheBudget } from './ParseCacheBudget';

const MIB = 1024 * 1024;

// The largest stored deck a preview, the edited-deck download and a send to
// Ankify read and parse. Larger decks are still downloaded as stored.
export const PREVIEW_MAX_STORED_BYTES = 256 * MIB;

// Cold loads (the read and parse of a deck that is not cached) are weighted
// by the deck's stored size and run together up to this total; the rest wait
// in order. A deck above the total still runs, alone.
export const COLD_LOAD_BUDGET_BYTES = 512 * MIB;

// Every cold load weighs at least this much, so at most four run at once:
// stored size is only a rough guide to what a load uses.
export const COLD_LOAD_MIN_WEIGHT_BYTES = 128 * MIB;

// Estimated bytes all preview caches may keep together. A parsed deck larger
// than this is served to the requests waiting on it but not kept.
export const PARSE_CACHE_BUDGET_BYTES = 1024 * MIB;

// How long a cold load may spend reading a deck from storage while it holds
// its place. Reads the largest deck a preview accepts (256 MiB) at under
// 1 MiB/s, well below what storage normally delivers.
export const PREVIEW_READ_TIME_LIMIT_MS = 5 * 60 * 1000;

export function coldLoadWeight(storedBytes: number): number {
  return Math.max(storedBytes, COLD_LOAD_MIN_WEIGHT_BYTES);
}

interface SharedPreviewLimits {
  coldLoads: WeightedSemaphore;
  cacheBudget: ParseCacheBudget;
}

function freshSharedLimits(): SharedPreviewLimits {
  return {
    coldLoads: new WeightedSemaphore(COLD_LOAD_BUDGET_BYTES),
    cacheBudget: new ParseCacheBudget(PARSE_CACHE_BUDGET_BYTES),
  };
}

let shared = freshSharedLimits();

export function sharedPreviewLimits(): SharedPreviewLimits {
  return shared;
}

export function resetPreviewMemoryLimitsForTesting(): void {
  shared = freshSharedLimits();
}
