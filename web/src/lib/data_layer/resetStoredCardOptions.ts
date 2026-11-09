import CardOption from './model/CardOption';
import { clearSavedCardSettings } from '../upload/savedCardSettings';

export const CARD_OPTION_VALUE_KEYS = [
  'deckName',
  'font-size',
  'text-color',
  'text-align',
  'template',
  'toggle-mode',
  'overlapping-cloze',
  'code-theme',
  'page-emoji',
  'basic_model_name',
  'cloze_model_name',
  'input_model_name',
  'user-instructions',
  'mcq-enabled',
  'mcq-tts-question',
  'mcq-tts-correct-answer',
  'mcq-tts-extra',
  'tts-auto-detect',
  'tts-manual-lang',
  'tts-manual-side',
  'card-size',
  'card-style',
  'pdf-page-range',
] as const;

export const resetStoredCardOptions = (options: CardOption[]) => {
  for (const option of options) {
    localStorage.removeItem(option.key);
  }
  for (const key of CARD_OPTION_VALUE_KEYS) {
    localStorage.removeItem(key);
  }
};

// Reset to defaults in Settings: also every other setting an upload sends,
// so the reset the over-long-setting copy suggests always works. A Notion
// page's reset keeps to the keys above.
export const resetAllSavedCardSettings = (options: CardOption[]) => {
  resetStoredCardOptions(options);
  clearSavedCardSettings();
};
