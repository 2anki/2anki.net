export const FREE_TIER_LIMIT = 3;

export interface FreeSlotsResult<T> {
  kept: T[];
  dropped: number;
}

export function takeFreeSlots<T>(
  currentCount: number,
  incoming: T[],
  isPaying: boolean
): FreeSlotsResult<T> {
  if (isPaying) {
    return { kept: incoming, dropped: 0 };
  }
  const room = Math.max(0, FREE_TIER_LIMIT - currentCount);
  return {
    kept: incoming.slice(0, room),
    dropped: Math.max(0, incoming.length - room),
  };
}
