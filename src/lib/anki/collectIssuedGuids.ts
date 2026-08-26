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
 * Pairs python's guids.json sidecar back to the cards that produced it. The
 * GUID value is computed by python (the legacy content formula lives there);
 * any pairing doubt fails safe to null, so nothing wrong is ever pinned.
 */
function pairSidecarWithCards(
  location: string,
  decks: Deck[]
): IssuedCardGuid[] | null {
  const sidecar = readSidecar(location);
  if (sidecar == null) {
    return null;
  }
  const cards = decks.flatMap((deck) => deck.cards);
  if (sidecar.length !== cards.length) {
    console.warn(
      `[guid-ledger] sidecar length mismatch: ${sidecar.length} entries for ${cards.length} cards`
    );
    return null;
  }
  const paired: IssuedCardGuid[] = [];
  for (const [index, card] of cards.entries()) {
    const entry = sidecar[index];
    if ((entry.notionId ?? undefined) !== card.notionId) {
      console.warn('[guid-ledger] sidecar notionId misalignment, skipping');
      return null;
    }
    if (card.notionId == null || entry.guid == null) {
      continue;
    }
    paired.push({
      blockId: card.notionId,
      sourcePageId: card.sourcePageId,
      guid: entry.guid,
    });
  }
  return paired;
}

function firstPerBlock(
  paired: IssuedCardGuid[],
  keep: (entry: IssuedCardGuid) => boolean
): IssuedCardGuid[] {
  const issued = new Map<string, IssuedCardGuid>();
  for (const entry of paired) {
    if (issued.has(entry.blockId) || !keep(entry)) {
      continue;
    }
    issued.set(entry.blockId, entry);
  }
  return [...issued.values()];
}

/** The entries the user's ledger does not hold yet. */
export function collectIssuedGuids(
  location: string,
  decks: Deck[],
  knownGuids?: KnownGuids
): IssuedCardGuid[] {
  if (knownGuids == null) {
    return [];
  }
  const paired = pairSidecarWithCards(location, decks);
  if (paired == null) {
    return [];
  }
  return firstPerBlock(paired, (entry) => knownGuids[entry.blockId] == null);
}

/**
 * The entries whose GUID python just issued differs from what the ledger
 * holds, plus the ones it does not hold at all. Used when the block-id
 * identity option re-keys a page so the ledger follows the new identity.
 */
export function collectRekeyedGuids(
  location: string,
  decks: Deck[],
  knownGuids: KnownGuids
): IssuedCardGuid[] {
  const paired = pairSidecarWithCards(location, decks);
  if (paired == null) {
    return [];
  }
  return firstPerBlock(
    paired,
    (entry) => knownGuids[entry.blockId] !== entry.guid
  );
}
