import fs from 'node:fs';
import path from 'node:path';
import { mergePdfImageFallbackMarker } from '../../infrastracture/adapters/fileConversion/pdfImageFallbackMarker';
import type Workspace from '../../lib/parser/WorkSpace';

// The downloader lists decks by reading the top-level workspace, so a deck
// built in a per-conversion subdirectory has to be lifted back up. A name that
// is already taken gets a suffix rather than replacing the deck that got there
// first — silently overwriting is the failure this whole change removes.
export async function liftDecksToParent(from: Workspace, to: Workspace) {
  if (!fs.existsSync(from.location)) return;
  mergePdfImageFallbackMarker(from.location, to.location);
  const entries = await fs.promises.readdir(from.location);
  for (const entry of entries) {
    if (!entry.endsWith('.apkg')) continue;
    const extension = path.extname(entry);
    const base = entry.slice(0, -extension.length);
    let candidate = entry;
    let suffix = 2;
    while (fs.existsSync(path.join(to.location, candidate))) {
      candidate = `${base} (${suffix})${extension}`;
      suffix += 1;
    }
    await fs.promises.rename(
      path.join(from.location, entry),
      path.join(to.location, candidate)
    );
  }
}
