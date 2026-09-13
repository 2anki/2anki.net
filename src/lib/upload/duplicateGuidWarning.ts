// Two notes with one guid import as one note, so the deck Anki shows is
// smaller than the one 2anki previewed. The count is only known once python
// has issued the guids, so the warning rides the upload warning channel.
export const DUPLICATE_GUID_WARNING_RE = /^duplicate-guid:(\d+)$/;

export function duplicateGuidWarning(dropped: number): string | null {
  if (dropped <= 0) return null;
  return `duplicate-guid:${dropped}`;
}

export function duplicateGuidWarningText(dropped: number): string {
  if (dropped === 1) {
    return '1 card repeats the question of another card in the same deck, so Anki keeps only the first. You import 1 card fewer than you see here. Give it a different question and convert again.';
  }
  return `${dropped} cards repeat the question of another card in the same deck, so Anki keeps only the first of each. You import ${dropped} cards fewer than you see here. Make the repeated questions different and convert again.`;
}
