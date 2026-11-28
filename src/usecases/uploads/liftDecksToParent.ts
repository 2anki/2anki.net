import fs from 'node:fs';
import path from 'node:path';
import { mergePdfImageFallbackMarker } from '../../infrastracture/adapters/fileConversion/pdfImageFallbackMarker';
import type Workspace from '../../lib/parser/WorkSpace';

async function realPathOrNull(candidate: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(candidate);
  } catch {
    return null;
  }
}

// The downloader lists decks by reading the top-level workspace, so a deck
// built in a per-conversion subdirectory has to be lifted back up. A name that
// is already taken gets a suffix rather than replacing the deck that got there
// first — silently overwriting is the failure this whole change removes. A deck
// built in `from` follows its file to the new name, so a background job still
// stores exactly the files its packages wrote. The deck writer reports a real
// path while the workspace may sit under a symlink, so files are matched by
// real path.
export async function liftDecksToParent(
  from: Workspace,
  to: Workspace,
  builtDecks: readonly { apkgPath?: string }[] = []
): Promise<string[]> {
  if (!fs.existsSync(from.location)) return [];
  mergePdfImageFallbackMarker(from.location, to.location);
  const builtReal = await Promise.all(
    builtDecks.map((built) =>
      built.apkgPath == null ? null : realPathOrNull(built.apkgPath)
    )
  );
  const entries = await fs.promises.readdir(from.location);
  const lifted: string[] = [];
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
    const origin = path.join(from.location, entry);
    const originReal = await realPathOrNull(origin);
    const destination = path.resolve(to.location, candidate);
    await fs.promises.rename(origin, destination);
    builtDecks.forEach((built, index) => {
      if (originReal != null && builtReal[index] === originReal) {
        built.apkgPath = destination;
      }
    });
    lifted.push(candidate);
  }
  return lifted;
}
