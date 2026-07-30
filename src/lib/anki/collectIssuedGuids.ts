import fs from 'node:fs';
import path from 'node:path';

import type Deck from '../parser/Deck';
import type { IssuedCardGuid, KnownGuids } from './guidLedgerTypes';

interface SidecarEntry {
  notionId?: string | null;
  guid?: string;
}

function readSidecar(location: string): SidecarEntry[] | null {
  try {
    const raw = fs.readFileSync(path.join(location, 'guids.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Pairs python's guids.json sidecar back to the cards that produced it and
 * returns the entries the user's ledger does not hold yet. The GUID value is
 * computed by python (the legacy content formula lives there); any pairing
 * doubt fails safe to an empty list, so nothing wrong is ever pinned.
 */
export function collectIssuedGuids(
  location: string,
  decks: Deck[],
  knownGuids?: KnownGuids
): IssuedCardGuid[] {
  if (knownGuids == null) {
    return [];
  }
  const sidecar = readSidecar(location);
  if (sidecar == null) {
    return [];
  }
  const cards = decks.flatMap((deck) => deck.cards);
  if (sidecar.length !== cards.length) {
    console.warn(
      `[guid-ledger] sidecar length mismatch: ${sidecar.length} entries for ${cards.length} cards`
    );
    return [];
  }
  const issued = new Map<string, IssuedCardGuid>();
  for (const [index, card] of cards.entries()) {
    const entry = sidecar[index];
    if ((entry.notionId ?? undefined) !== card.notionId) {
      console.warn('[guid-ledger] sidecar notionId misalignment, skipping');
      return [];
    }
    if (card.notionId == null || entry.guid == null) {
      continue;
    }
    if (knownGuids[card.notionId] != null || issued.has(card.notionId)) {
      continue;
    }
    issued.set(card.notionId, {
      blockId: card.notionId,
      sourcePageId: card.sourcePageId,
      guid: entry.guid,
    });
  }
  return [...issued.values()];
}
