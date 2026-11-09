import { CARD_OPTION_KEYS } from '../data_layer/userPreferencesSync';
import { PDF_FALLBACK_OPTION } from './pdfFallback';

// The card settings this browser saves. An upload sends only these, never the
// rest of localStorage (the pass token, theme, language, email), and Reset to
// defaults clears exactly these, so an over-long one can always be reset.
export const SAVED_CARD_SETTING_KEYS: readonly string[] = [
  ...CARD_OPTION_KEYS,
  'block-id-identity',
  PDF_FALLBACK_OPTION,
];

export function savedCardSettings(): Record<string, string> {
  const storage = globalThis.localStorage;
  if (storage == null) return {};
  const settings: Record<string, string> = {};
  for (const key of SAVED_CARD_SETTING_KEYS) {
    const value = storage.getItem(key);
    if (value != null) settings[key] = value;
  }
  return settings;
}

export function appendSavedCardSettings(formData: FormData): void {
  for (const [key, value] of Object.entries(savedCardSettings())) {
    formData.append(key, value);
  }
}

export function clearSavedCardSettings(): void {
  for (const key of SAVED_CARD_SETTING_KEYS) {
    globalThis.localStorage?.removeItem(key);
  }
}
