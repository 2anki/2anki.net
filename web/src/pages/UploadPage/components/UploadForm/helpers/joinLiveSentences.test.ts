import { describe, expect, it } from 'vitest';

import { joinLiveSentences } from './joinLiveSentences';

describe('joinLiveSentences', () => {
  it.each([
    [
      'en',
      'Conversion failed.',
      'Choose again.',
      'Conversion failed. Choose again.',
    ],
    [
      'en',
      'Your deck is ready',
      'Choose again.',
      'Your deck is ready. Choose again.',
    ],
    ['de', 'Fertig!', 'Wähle erneut.', 'Fertig! Wähle erneut.'],
    ['fr', 'Prêt', 'Choisis à nouveau.', 'Prêt. Choisis à nouveau.'],
    [
      'ja',
      '変換に失敗しました。',
      'もう一度選んでください。',
      '変換に失敗しました。もう一度選んでください。',
    ],
    [
      'ja',
      'デッキの準備ができました — 64 枚',
      'もう一度選んでください。',
      'デッキの準備ができました — 64 枚。もう一度選んでください。',
    ],
    [
      'ja-JP',
      '準備ができました',
      '選んでください。',
      '準備ができました。選んでください。',
    ],
  ])('joins in %s: "%s" + "%s"', (language, status, line, joined) => {
    expect(joinLiveSentences(status, line, language)).toBe(joined);
  });

  it('says only the line when there is no status', () => {
    expect(joinLiveSentences('', 'Choose again.', 'ja')).toBe('Choose again.');
  });
});
