// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';

import CardOption from './model/CardOption';
import {
  CARD_OPTION_VALUE_KEYS,
  resetAllSavedCardSettings,
  resetStoredCardOptions,
} from './resetStoredCardOptions';

describe('resetStoredCardOptions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes every stored card-option value key', () => {
    for (const key of CARD_OPTION_VALUE_KEYS) {
      localStorage.setItem(key, 'stale');
    }

    resetStoredCardOptions([]);

    for (const key of CARD_OPTION_VALUE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('removes the dynamic checkbox option keys', () => {
    localStorage.setItem('cloze', 'true');
    localStorage.setItem('embed-images', 'false');

    resetStoredCardOptions([
      new CardOption('cloze', 'Cloze', 'desc', true),
      new CardOption('embed-images', 'Embed', 'desc', true),
    ]);

    expect(localStorage.getItem('cloze')).toBeNull();
    expect(localStorage.getItem('embed-images')).toBeNull();
  });

  it('leaves non-card-option keys untouched', () => {
    localStorage.setItem('token', 'session-abc');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('deckName', 'Pharmacology');

    resetStoredCardOptions([]);

    expect(localStorage.getItem('token')).toBe('session-abc');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('deckName')).toBeNull();
  });

  it('clears every setting an upload sends in a Settings reset, so it always fixes an over-long one, and keeps the pass token', () => {
    localStorage.setItem('share-files-for-debugging', 'true');
    localStorage.setItem('pdf-fallback', 'pairs');
    localStorage.setItem('block-id-identity', 'true');
    localStorage.setItem('2anki_pass_token', 'cs_pass');

    resetAllSavedCardSettings([]);

    expect(localStorage.getItem('share-files-for-debugging')).toBeNull();
    expect(localStorage.getItem('pdf-fallback')).toBeNull();
    expect(localStorage.getItem('block-id-identity')).toBeNull();
    expect(localStorage.getItem('2anki_pass_token')).toBe('cs_pass');
  });

  it('keeps the remembered PDF choice in a Notion page reset', () => {
    localStorage.setItem('pdf-fallback', 'pairs');

    resetStoredCardOptions([]);

    expect(localStorage.getItem('pdf-fallback')).toBe('pairs');
  });

  it('includes the keys named in the bug report in the value key list', () => {
    expect(CARD_OPTION_VALUE_KEYS).toEqual(
      expect.arrayContaining([
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
      ])
    );
  });
});
