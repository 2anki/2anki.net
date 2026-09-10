import { createHash } from 'crypto';

import { cardFingerprint, normalizeCardText } from '../claude/ClaudeService';
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
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

export interface ResolveUploadCardGuidParams {
  owner: number;
  identityKey: string;
  sourceKeyHash: string;
  fingerprint: string;
  stored?: StoredUploadIdentity;
}

export interface ResolvedUploadCardGuid {
  guid: string;
  decision: UploadIdentityDecision;
}

// The ambiguity guard. On first sight the guid is the deterministic
// guidFor(owner, identityKey). On a ledger hit we replay the stored guid when
// the answer is unchanged (fingerprint match — a rename or reorder) OR the file
// is unchanged (sourceKey match — an answer edit). When BOTH the filename and
// the answer changed, the card is probably a different fact that happens to
// share a question, so we issue a fresh guid — a visible duplicate beats
// silently overwriting an unrelated card.
export function resolveUploadCardGuid(
  params: ResolveUploadCardGuidParams
): ResolvedUploadCardGuid {
  const { owner, identityKey, sourceKeyHash, fingerprint, stored } = params;
  if (stored == null) {
    return { decision: 'issued', guid: guidFor(owner, identityKey) };
  }
  if (
    stored.fingerprint === fingerprint ||
    stored.sourceKeyHash === sourceKeyHash
  ) {
    return { decision: 'replayed', guid: stored.guid };
  }
  return {
    decision: 'guarded',
    guid: guidFor(owner, identityKey, fingerprint),
  };
}
