import fs from 'node:fs';
import path from 'node:path';

export interface BuiltDeck {
  apkgPath?: string;
  cardCount: number;
}

export interface DeckToStore {
  apkgPath: string;
  cardCount: number;
}

async function realPathOrNull(candidate: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(candidate);
  } catch {
    return null;
  }
}

function isInside(realWorkspace: string, realFile: string): boolean {
  const relative = path.relative(realWorkspace, realFile);
  if (relative === '' || path.isAbsolute(relative)) return false;
  return relative.split(path.sep)[0] !== '..';
}

// The deck writer reports the path it wrote from its own working directory,
// which is the real path, while the workspace may sit under a symlink (macOS
// /tmp), so both sides are compared as real paths. A deck file that is itself
// a symlink, or that resolves outside the workspace, is never stored.
async function realDeckFile(
  realWorkspace: string,
  recorded: string
): Promise<string | null> {
  try {
    if (!(await fs.promises.lstat(recorded)).isFile()) return null;
  } catch {
    return null;
  }
  const real = await realPathOrNull(recorded);
  return real != null && isInside(realWorkspace, real) ? real : null;
}

// What a background job stores comes from its own packages, never from a
// directory listing: an uploaded zip can leave files named like decks in the
// workspace, and those were never converted or counted. Two packages that wrote
// the same file leave the later one's cards in it, so that file counts once,
// with the cards it holds.
export async function decksToStore(
  jobId: string,
  workspaceDir: string,
  builtDecks: readonly BuiltDeck[]
): Promise<DeckToStore[]> {
  const realWorkspace = await realPathOrNull(workspaceDir);
  if (realWorkspace == null) return [];
  const byPath = new Map<string, DeckToStore>();
  for (const built of builtDecks) {
    if (built.apkgPath == null) {
      if (built.cardCount > 0) {
        console.error('[decksToStore] a package with cards has no deck file', {
          jobId,
        });
      }
      continue;
    }
    const real = await realDeckFile(realWorkspace, built.apkgPath);
    if (real == null) {
      console.warn('[decksToStore] a recorded deck file was not stored', {
        jobId,
      });
      continue;
    }
    byPath.set(real, { apkgPath: real, cardCount: built.cardCount });
  }
  return [...byPath.values()];
}

export function cardsIn(decks: readonly DeckToStore[]): number {
  return decks.reduce((sum, deck) => sum + deck.cardCount, 0);
}
