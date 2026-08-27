import {
  ALLOWED_CARD_OPTION_KEYS,
  CardOptions,
  InMemoryUserPreferencesRepository,
  sanitizeCardOptions,
} from './UserPreferencesRepository';

describe('InMemoryUserPreferencesRepository card options', () => {
  it('merges a patch into the stored options instead of replacing them', async () => {
    const repo = new InMemoryUserPreferencesRepository();
    await repo.setBlockIdIdentity(3, true);

    const prefs = await repo.patch(3, { cardOptions: { template: 'custom' } });

    expect(prefs.cardOptions).toEqual({
      'block-id-identity': 'true',
      template: 'custom',
    });
  });

  it('keeps stored options untouched when a patch carries none', async () => {
    const repo = new InMemoryUserPreferencesRepository();
    await repo.patch(3, { cardOptions: { template: 'custom' } });

    const prefs = await repo.patch(3, { theme: 'dark' });

    expect(prefs.cardOptions).toEqual({ template: 'custom' });
  });

  it('leaves card options null when disabling on an account with none', async () => {
    const repo = new InMemoryUserPreferencesRepository();

    const prefs = await repo.setBlockIdIdentity(3, false);

    expect(prefs.cardOptions).toBeNull();
  });
});

describe('sanitizeCardOptions card-option allowlist', () => {
  it('keeps every boolean toggle key', () => {
    const cardOptions: CardOptions = {
      cherry: 'true',
      avocado: 'true',
      tags: 'true',
      all: 'false',
      cloze: 'true',
      'basic-reversed': 'true',
      reversed: 'false',
      'no-underline': 'true',
      'max-one-toggle-per-card': 'true',
      'enable-input': 'true',
      paragraph: 'false',
      'perserve-newlines': 'true',
      'remove-mp3-links': 'true',
      'embed-images': 'true',
      'process-pdfs': 'true',
      'download-pdfs': 'true',
    };

    expect(sanitizeCardOptions(cardOptions)).toEqual(cardOptions);
  });

  it('keeps the non-checkbox option keys', () => {
    const cardOptions: CardOptions = {
      'overlapping-cloze': 'separate',
      'code-theme': 'dracula',
      'card-size': 'large',
      'field-mapping': '{"front":"Term","back":"Definition"}',
    };

    expect(sanitizeCardOptions(cardOptions)).toEqual(cardOptions);
  });

  it('drops keys outside the allowlist', () => {
    const result = sanitizeCardOptions({
      cherry: 'true',
      'not-a-real-option': 'true',
    } as CardOptions);

    expect(result).toEqual({ cherry: 'true' });
  });

  it('drops non-string values', () => {
    const result = sanitizeCardOptions({
      cherry: 'true',
      tags: undefined,
    });

    expect(result).toEqual({ cherry: 'true' });
  });

  it('allows every key the client collects', () => {
    const clientKeys = CLIENT_CARD_OPTION_KEYS;
    for (const key of clientKeys) {
      expect(ALLOWED_CARD_OPTION_KEYS.has(key)).toBe(true);
    }
  });
});

const CLIENT_CARD_OPTION_KEYS = [
  // Mirror of CARD_OPTION_KEYS in web/src/lib/data_layer/userPreferencesSync.ts.
  // Both lists must equal ALLOWED_CARD_OPTION_KEYS in this file; this test guards the agreement.
  'deckName',
  'font-size',
  'text-color',
  'text-align',
  'template',
  'toggle-mode',
  'page-emoji',
  'basic_model_name',
  'cloze_model_name',
  'input_model_name',
  'user-instructions',
  'skip-defaults',
  'overlapping-cloze',
  'code-theme',
  'card-size',
  'field-mapping',
  'mcq-enabled',
  'mcq-tts-question',
  'mcq-tts-correct-answer',
  'mcq-tts-extra',
  'tts-auto-detect',
  'tts-manual-lang',
  'tts-manual-side',
  'add-notion-link',
  'use-notion-id',
  'all',
  'paragraph',
  'cherry',
  'avocado',
  'tags',
  'section-tags',
  'cloze',
  'cloze-from-toggle-content',
  'group-cloze-per-toggle',
  'enable-input',
  'basic-reversed',
  'reversed',
  'no-underline',
  'max-one-toggle-per-card',
  'remove-mp3-links',
  'perserve-newlines',
  'process-pdfs',
  'pdf-extract-text',
  'pdf-page-pairs',
  'download-pdfs',
  'markdown-nested-bullet-points',
  'split-sections-into-decks',
  'vertex-ai-pdf-questions',
  'disable-indented-bullets',
  'image-quiz-html-to-anki',
  'embed-images',
  'claude-ai-flashcards',
  'ai-comprehensive',
  'share-files-for-debugging',
];
