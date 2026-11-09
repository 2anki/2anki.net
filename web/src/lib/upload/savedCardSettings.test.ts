// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendSavedCardSettings,
  clearSavedCardSettings,
  savedCardSettings,
} from './savedCardSettings';

const NOT_SETTINGS = {
  '2anki_pass_token': 'cs_pass',
  '2anki-theme': 'dark',
  email: 'someone@example.com',
  'photoToFlashcards.cardCount': '20',
};

describe('saved card settings', () => {
  afterEach(() => localStorage.clear());

  it('sends the card settings and nothing else from this browser', () => {
    localStorage.setItem('deckName', 'Biology');
    localStorage.setItem('cloze', 'true');
    localStorage.setItem('pdf-fallback', 'pairs');
    for (const [key, value] of Object.entries(NOT_SETTINGS)) {
      localStorage.setItem(key, value);
    }

    const formData = new FormData();
    appendSavedCardSettings(formData);

    expect(Object.fromEntries(formData.entries())).toEqual({
      deckName: 'Biology',
      cloze: 'true',
      'pdf-fallback': 'pairs',
    });
  });

  it('clears every setting an upload sends and keeps the pass token', () => {
    localStorage.setItem('deckName', 'x'.repeat(10));
    localStorage.setItem('share-files-for-debugging', 'true');
    localStorage.setItem('2anki_pass_token', 'cs_pass');

    clearSavedCardSettings();

    expect(savedCardSettings()).toEqual({});
    expect(localStorage.getItem('2anki_pass_token')).toBe('cs_pass');
  });
});
