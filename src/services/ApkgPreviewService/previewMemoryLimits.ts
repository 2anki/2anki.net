import { WeightedSemaphore } from '../../lib/rateLimit/WeightedSemaphore';
import { ParseCacheBudget } from './ParseCacheBudget';

const MIB = 1024 * 1024;

// Cold loads (the read and parse of a deck that is not cached) are weighted
// by the deck's stored size and run together up to this total; the rest wait
// in order. A deck above the total still runs, alone.
export const COLD_LOAD_BUDGET_BYTES = 512 * MIB;

// Every cold load weighs at least this much, so at most four run at once
// whatever their stored size: the stored size does not show how far an
// archive unpacks.
export const COLD_LOAD_MIN_WEIGHT_BYTES = 128 * MIB;

// Estimated bytes all preview caches may keep together. A parsed deck larger
// than this is served to the requests waiting on it but not kept.
export const PARSE_CACHE_BUDGET_BYTES = 1024 * MIB;

export function coldLoadWeight(storedBytes: number): number {
  return Math.max(storedBytes, COLD_LOAD_MIN_WEIGHT_BYTES);
}

export const sharedColdLoads = new WeightedSemaphore(COLD_LOAD_BUDGET_BYTES);

export const sharedParseCacheBudget = new ParseCacheBudget(
  PARSE_CACHE_BUDGET_BYTES
);
