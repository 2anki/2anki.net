import { AI_GIFT_MARKER_MAX_AGE_MS } from './giftTerms';

// One conversion per account may draw on the gift at a time in this process.
// A conversion's in-flight holds live in its own worker or in the web process,
// so two conversions would each get a fresh set of holds; one at a time keeps
// the gift's overshoot to one conversion's. Taking the marker is synchronous,
// so two requests can never both pass the check between awaits.
export interface GiftMarker {
  userId: number;
  token: symbol;
}

const markers = new Map<number, { token: symbol; takenAt: number }>();

export function takeGiftMarker(
  userId: number,
  now: number = Date.now()
): GiftMarker | null {
  const held = markers.get(userId);
  if (held != null && now - held.takenAt < AI_GIFT_MARKER_MAX_AGE_MS) {
    return null;
  }
  const token = Symbol('gift-marker');
  markers.set(userId, { token, takenAt: now });
  return { userId, token };
}

// Releases only the marker this conversion took, so a conversion that outlived
// the maximum age cannot clear the marker a newer conversion now holds.
export function releaseGiftMarker(marker: GiftMarker | null | undefined): void {
  if (marker == null) return;
  if (markers.get(marker.userId)?.token === marker.token) {
    markers.delete(marker.userId);
  }
}

export function resetGiftMarkers(): void {
  markers.clear();
}
