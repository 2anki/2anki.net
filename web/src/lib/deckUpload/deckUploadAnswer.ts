// What the deck tools (print, CSV) answer when an upload is not one deck: the
// zip holds several decks to pick from, or it holds notes to turn into a deck.
export type DeckUploadAnswer =
  | { kind: 'choose_deck'; decks: string[] }
  | { kind: 'not_a_deck' };

// The router state key a deck tool and the upload page use to hand a picked
// file to each other, so nobody has to pick it twice.
export const HANDOFF_FILE_STATE_KEY = 'handoffFile';

export function readHandoffFile(state: unknown): File | null {
  if (state == null || typeof state !== 'object') return null;
  const file = (state as Record<string, unknown>)[HANDOFF_FILE_STATE_KEY];
  return file instanceof File ? file : null;
}

export async function readDeckUploadAnswer(
  response: Response
): Promise<DeckUploadAnswer | null> {
  if (response.status !== 409 && response.status !== 422) return null;
  try {
    const body = (await response.clone().json()) as {
      code?: unknown;
      decks?: unknown;
    };
    if (body.code === 'not_a_deck') return { kind: 'not_a_deck' };
    if (
      body.code === 'choose_deck' &&
      Array.isArray(body.decks) &&
      body.decks.every((deck) => typeof deck === 'string')
    ) {
      return { kind: 'choose_deck', decks: body.decks as string[] };
    }
  } catch {
    // not JSON
  }
  return null;
}

export function deckLabel(entry: string): string {
  const base = entry.slice(entry.lastIndexOf('/') + 1);
  return base.replace(/\.apkg$/i, '') || entry;
}

export function isDeckUploadName(name: string): boolean {
  return /\.(apkg|zip)$/i.test(name);
}

export function stripDeckExtension(name: string): string {
  return name.replace(/\.(apkg|zip)$/i, '');
}
