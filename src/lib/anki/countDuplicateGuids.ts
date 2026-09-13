import fs from 'node:fs';
import path from 'node:path';

// Anki treats notes with the same guid as one note: the first imports, the
// rest are "updated" or "skipped" and the user never sees them. Python owns
// the guid formula, so the count comes from its guids.json sidecar rather
// than a TS re-derivation that could drift. Returns how many notes Anki
// drops: every note past the first in each guid group.
export function countDuplicateGuids(location: string): number {
  let entries: unknown;
  try {
    entries = JSON.parse(
      fs.readFileSync(path.join(location, 'guids.json'), 'utf8')
    );
  } catch {
    return 0;
  }
  if (!Array.isArray(entries)) return 0;
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of entries) {
    const guid = (entry as { guid?: unknown })?.guid;
    if (typeof guid !== 'string') continue;
    if (seen.has(guid)) dropped += 1;
    seen.add(guid);
  }
  return dropped;
}
