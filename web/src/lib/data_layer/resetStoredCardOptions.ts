import CardOption from './model/CardOption';

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
] as const;

export const resetStoredCardOptions = (options: CardOption[]) => {
  for (const option of options) {
    localStorage.removeItem(option.key);
  }
  for (const key of CARD_OPTION_VALUE_KEYS) {
    localStorage.removeItem(key);
  }
};
