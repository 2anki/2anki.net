// The router state the upload card hands to the upload form: the files the
// person chose and, from the convert step, whether Claude makes the cards.
export const GIFT_HANDOFF_STATE_KEY = 'giftHandoff';

export interface GiftHandoff {
  files: File[];
  claude: boolean | null;
}

export function giftHandoffState(handoff: GiftHandoff) {
  return { [GIFT_HANDOFF_STATE_KEY]: handoff };
}

export function readGiftHandoff(state: unknown): GiftHandoff | null {
  if (state == null || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[GIFT_HANDOFF_STATE_KEY];
  if (value == null || typeof value !== 'object') return null;
  const { files, claude } = value as Record<string, unknown>;
  if (!Array.isArray(files)) return null;
  const kept = files.filter((file): file is File => file instanceof File);
  if (kept.length === 0) return null;
  return { files: kept, claude: typeof claude === 'boolean' ? claude : null };
}
