import { ALLOWED_CARD_OPTION_KEYS } from '../../data_layer/UserPreferencesRepository';

// A held deck is rebuilt with nobody on the page, so only the options that
// shape the deck travel with it. The request body also carries cloud-import
// tokens and file lists, and older clients sent the browser's whole
// localStorage; none of that is an option, so the keys are an allowlist,
// never a denylist.
//
// The paid-inference switches never travel: a held deck was always built
// without AI, so its claim must not start a Claude run the hold never had.
// user-instructions only steers Claude, which a claim never runs.
// share-files-for-debugging is a consent given for one upload, not a deck
// setting. pdf-page-range stays attempt-scoped, so a claim converts the whole
// file. rescue-rule is a closed enum the parser validates, and a deck shipped
// through a chosen rescue is empty without it.
const NEVER_HELD = new Set([
  'claude-ai-flashcards',
  'ai-choice-at',
  'ai-comprehensive',
  'image-quiz-html-to-anki',
  'share-files-for-debugging',
  'user-instructions',
]);

const HELD_ONLY_KEYS = ['global-tags', 'rescue-rule'];

const HELD_KEYS: ReadonlySet<string> = new Set(
  [...ALLOWED_CARD_OPTION_KEYS, ...HELD_ONLY_KEYS].filter(
    (key) => !NEVER_HELD.has(key)
  )
);

const DEFAULT_MAX_VALUE_LENGTH = 512;
const MAX_VALUE_LENGTH = new Map([['field-mapping', 10_000]]);

export const CLAIM_INFERENCE_OFF: Readonly<Record<string, string>> = {
  'claude-ai-flashcards': 'false',
  'image-quiz-html-to-anki': 'false',
};

function fitsLength(key: string, value: string): boolean {
  return (
    value.length <= (MAX_VALUE_LENGTH.get(key) ?? DEFAULT_MAX_VALUE_LENGTH)
  );
}

export function allowedHeldCardOptions(
  raw: unknown
): Record<string, string> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const kept = Object.entries(raw).filter(
    (entry): entry is [string, string] =>
      HELD_KEYS.has(entry[0]) &&
      typeof entry[1] === 'string' &&
      fitsLength(entry[0], entry[1])
  );
  return kept.length === 0 ? null : Object.fromEntries(kept);
}
