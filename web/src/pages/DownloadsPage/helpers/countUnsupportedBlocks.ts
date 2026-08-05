/**
 * The payload records unsupported blocks per type. The badge speaks in blocks,
 * so it needs the total rather than the number of distinct types.
 */
export function countUnsupportedBlocks(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}
