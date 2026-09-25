// Two notes with one guid import as one note, so the deck Anki shows is
// smaller than the one 2anki previewed. The count is only known once python
// has issued the guids, so the warning rides the upload warning channel.
export const DUPLICATE_GUID_WARNING_RE = /^duplicate-guid:(\d+)$/;

export function duplicateGuidWarning(dropped: number): string | null {
  if (dropped <= 0) return null;
  return `duplicate-guid:${dropped}`;
}

// #4424 narrowed what still reaches this warning: a same-question card whose
// answer differs now forks into its own card instead of colliding here, so
// only a whole-card exact duplicate (same question AND answer) still lands
// on this path; the copy describes that, not a merely-repeated question.
// This text travels in the X-Warning response header, which is Latin-1 only:
// keep it ASCII (no em dash, no curly quotes) or the upload 400s.
export function duplicateGuidWarningText(dropped: number): string {
  if (dropped === 1) {
    return "1 card is an exact duplicate of another card in this deck (same question and answer). Anki keeps one, so you import 1 card fewer than you see here. If it wasn't meant to repeat, remove it and convert again.";
  }
  return `${dropped} cards are exact duplicates of other cards in this deck (same question and answer). Anki keeps one of each, so you import ${dropped} cards fewer than you see here. If they weren't meant to repeat, remove them and convert again.`;
}
