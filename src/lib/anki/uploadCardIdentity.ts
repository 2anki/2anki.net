import { createHash } from 'node:crypto';

import { normalizeCardText } from '../claude/ClaudeService';
import { guidFor } from './guid';

// Upload-deck card identity. A signed-in re-upload of an edited markdown, HTML,
// CSV or xlsx file replays the guid it issued last time instead of adding a
// duplicate, without depending on the deck name (which the legacy content
// formula keyed on and which every rename broke). The `u:` namespace keeps
// these keys disjoint from Notion UUID block_id rows in the shared card_guids
// ledger. Locked vocabulary — never extend the prefix or the card-type labels
// silently.
export const UPLOAD_IDENTITY_PREFIX = 'u:';

// A colon can never appear in the two hex halves it joins, and unlike a NUL
// byte it is safe to store in a Postgres text column.
const SOURCE_PACK_SEPARATOR = ':';

export interface UploadIdentityCard {
  name: string;
  back?: string;
  cloze?: boolean;
  mcq?: boolean;
  enableInput?: boolean;
}

export type UploadCardType = 'cloze' | 'mcq' | 'input' | 'basic';

type CardTypeFlags = Pick<UploadIdentityCard, 'cloze' | 'mcq' | 'enableInput'>;

// The same precedence create_deck/create_deck.py uses for the content formula,
// so a card's type label never drifts between the two languages.
export function uploadCardType(card: CardTypeFlags): UploadCardType {
  if (card.cloze) {
    return 'cloze';
  }
  if (card.mcq) {
    return 'mcq';
  }
  if (card.enableInput) {
    return 'input';
  }
  return 'basic';
}

// The stable identity of an upload card: its normalized front plus card type.
// The back and the deck/file name are deliberately absent so an answer edit, a
// rename, or a reorder all resolve to the same key. Identical fronts inside one
// upload get an ordinal suffix so they never collapse onto one guid.
export function uploadIdentityKey(
  card: UploadIdentityCard,
  ordinal = 1
): string {
  const base = guidFor(normalizeCardText(card.name), uploadCardType(card));
  const suffixed = ordinal > 1 ? `${base}#${ordinal}` : base;
  return `${UPLOAD_IDENTITY_PREFIX}${suffixed}`;
}

// The guard only needs filename equality, and filenames can carry the user's
// name, school, or employer — so the ledger stores a hash of the normalized
// filename, never the filename itself.
export function hashSourceKey(filename: string): string {
  const base = filename
    .replaceAll('\\', '/')
    .split('/')
    .pop()!
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, ' ');
  return createHash('sha256').update(base).digest('hex');
}

export function packIdentitySource(
  sourceKeyHash: string,
  fingerprint: string
): string {
  return `${sourceKeyHash}${SOURCE_PACK_SEPARATOR}${fingerprint}`;
}

export interface UnpackedIdentitySource {
  sourceKeyHash: string;
  fingerprint: string;
}

export function unpackIdentitySource(
  packed: string | null | undefined
): UnpackedIdentitySource {
  if (packed == null) {
    return { sourceKeyHash: '', fingerprint: '' };
  }
  const separator = packed.indexOf(SOURCE_PACK_SEPARATOR);
  if (separator < 0) {
    return { sourceKeyHash: packed, fingerprint: '' };
  }
  return {
    sourceKeyHash: packed.slice(0, separator),
    fingerprint: packed.slice(separator + SOURCE_PACK_SEPARATOR.length),
  };
}

export interface StoredUploadIdentity {
  guid: string;
  sourceKeyHash: string;
  fingerprint: string;
}

export type UploadIdentityLedger = Record<string, StoredUploadIdentity>;

interface RawLedgerRow {
  guid: string;
  sourcePageId: string | null;
}

// Turns the per-owner card_guids rows into the guard's lookup table, keeping
// only the u: rows this feature owns (Notion UUID rows are read by the block-id
// path) and unpacking the source_page_id column into its two logical fields.
export function buildUploadIdentityLedger(
  rows: Record<string, RawLedgerRow>
): UploadIdentityLedger {
  const ledger: UploadIdentityLedger = {};
  for (const [blockId, row] of Object.entries(rows)) {
    if (!blockId.startsWith(UPLOAD_IDENTITY_PREFIX)) {
      continue;
    }
    const { sourceKeyHash, fingerprint } = unpackIdentitySource(
      row.sourcePageId
    );
    ledger[blockId] = { guid: row.guid, sourceKeyHash, fingerprint };
  }
  return ledger;
}

export type UploadIdentityDecision = 'issued' | 'replayed' | 'guarded';

export interface UploadIdentityGroupCard {
  fingerprint: string;
}

export interface ResolvedUploadIdentity {
  identityKey: string;
  guid: string;
  decision: UploadIdentityDecision;
}

export interface ResolveUploadIdentityGroupParams {
  owner: number;
  sourceKeyHash: string;
  keyForOrdinal: (ordinal: number) => string;
  cards: UploadIdentityGroupCard[];
  ledger: UploadIdentityLedger;
}

interface IdentityCandidate {
  key: string;
  stored?: StoredUploadIdentity;
}

// Candidate keys for one front: every consecutive stored ordinal, plus enough
// free ordinals that each card in the group can take one.
function identityCandidates(
  keyForOrdinal: (ordinal: number) => string,
  ledger: UploadIdentityLedger,
  cardCount: number
): IdentityCandidate[] {
  const candidates: IdentityCandidate[] = [];
  let ordinal = 1;
  for (;;) {
    const key = keyForOrdinal(ordinal);
    const stored = ledger[key];
    candidates.push({ key, stored });
    if (stored == null && candidates.length >= cardCount) {
      return candidates;
    }
    ordinal += 1;
  }
}

// The ambiguity guard, resolved per front rather than per card so identical
// fronts follow their content, not their position. Every card in the group
// shares one base key; the group is the cards with that front in this upload.
//
// 1. A card whose back is unchanged claims the stored row with the same
//    fingerprint (a rename or a reorder — including reorders among cards that
//    share a front, which positional ordinals would silently cross-wire).
// 2. A card whose back changed replays only when nothing else could be meant:
//    it is the sole card with this front in the upload, exactly one row is
//    stored, and the file is the same (an answer edit in place).
// 3. Anything else that lands on a stored row is a different fact that happens
//    to share a question — issue a fresh guid. A visible duplicate beats
//    overwriting the wrong card's review history.
// 4. A card that lands on a free key is new: guidFor(owner, key).
export function resolveUploadIdentityGroup(
  params: ResolveUploadIdentityGroupParams
): ResolvedUploadIdentity[] {
  const { owner, sourceKeyHash, keyForOrdinal, cards, ledger } = params;
  const candidates = identityCandidates(keyForOrdinal, ledger, cards.length);
  const claimed = new Set<number>();
  const resolved: Array<ResolvedUploadIdentity | undefined> = new Array(
    cards.length
  );

  cards.forEach((card, index) => {
    const match = candidates.findIndex(
      (candidate, position) =>
        !claimed.has(position) &&
        candidate.stored?.fingerprint === card.fingerprint
    );
    if (match < 0) {
      return;
    }
    claimed.add(match);
    resolved[index] = {
      identityKey: candidates[match].key,
      guid: candidates[match].stored!.guid,
      decision: 'replayed',
    };
  });

  const storedCount = candidates.filter((c) => c.stored != null).length;
  const answerEditIsUnambiguous = cards.length === 1 && storedCount === 1;

  cards.forEach((card, index) => {
    if (resolved[index] != null) {
      return;
    }
    const position = candidates.findIndex((_, i) => !claimed.has(i));
    claimed.add(position);
    const { key, stored } = candidates[position];
    if (stored == null) {
      resolved[index] = {
        identityKey: key,
        guid: guidFor(owner, key),
        decision: 'issued',
      };
      return;
    }
    if (answerEditIsUnambiguous && stored.sourceKeyHash === sourceKeyHash) {
      resolved[index] = {
        identityKey: key,
        guid: stored.guid,
        decision: 'replayed',
      };
      return;
    }
    resolved[index] = {
      identityKey: key,
      guid: guidFor(owner, key, card.fingerprint),
      decision: 'guarded',
    };
  });

  return resolved as ResolvedUploadIdentity[];
}
