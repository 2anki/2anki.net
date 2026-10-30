import { forgetLastDeck } from './upload/lastDeck';
import { CARD_OPTION_KEYS } from './data_layer/userPreferencesSync';
import { PDF_FALLBACK_OPTION } from './upload/pdfFallback';

const PASS_TOKEN_KEY = '2anki_pass_token';

const HELD_CLAIM_OPTION_KEYS = [
  ...CARD_OPTION_KEYS,
  'block-id-identity',
  PDF_FALLBACK_OPTION,
];

export function getStoredPassToken(): string | null {
  return globalThis.localStorage?.getItem(PASS_TOKEN_KEY) ?? null;
}

export function storePassToken(sessionId: string): void {
  globalThis.localStorage?.setItem(PASS_TOKEN_KEY, sessionId);
}

export function storedCardOptions(): Record<string, string> {
  const storage = globalThis.localStorage;
  if (storage == null) return {};
  const options: Record<string, string> = {};
  for (const key of HELD_CLAIM_OPTION_KEYS) {
    const value = storage.getItem(key);
    if (value != null) options[key] = value;
  }
  return options;
}

export function clearPassToken(): void {
  globalThis.localStorage?.removeItem(PASS_TOKEN_KEY);
  void forgetLastDeck();
}
