import { allowedHeldCardOptions } from './heldCardOptions';

describe('allowedHeldCardOptions', () => {
  it('keeps the options that shape the deck, deck name and tags included', () => {
    expect(
      allowedHeldCardOptions({
        deckName: 'Biology',
        'global-tags': 'cells',
        cloze: 'false',
        'basic-reversed': 'true',
        'rescue-rule': 'heading',
      })
    ).toEqual({
      deckName: 'Biology',
      'global-tags': 'cells',
      cloze: 'false',
      'basic-reversed': 'true',
      'rescue-rule': 'heading',
    });
  });

  it('drops credentials, account details and file lists the request carries', () => {
    expect(
      allowedHeldCardOptions({
        deckName: 'Biology',
        googleDriveAuth: 'ya29.drive-access-token',
        '2anki_pass_token': 'pass-bearer-token',
        email: 'learner@example.com',
        files: '[{"id":"drive-file"}]',
        'ankify_session_url:abc': 'https://2anki.net/ankify/session',
        source: 'dropbox',
        link: 'https://www.dropbox.com/s/shared-link/notes.html',
        'kept-owner': '4242',
      })
    ).toEqual({ deckName: 'Biology' });
  });

  it.each([
    'claude-ai-flashcards',
    'ai-choice-at',
    'ai-comprehensive',
    'image-quiz-html-to-anki',
    'share-files-for-debugging',
    'user-instructions',
    'pdf-page-range',
    'pdf-fallback',
  ])('never holds %s', (key) => {
    expect(
      allowedHeldCardOptions({ deckName: 'Biology', [key]: 'true' })
    ).toEqual({
      deckName: 'Biology',
    });
  });

  it.each([
    ['deckName', 512],
    ['field-mapping', 10_000],
  ])('keeps %s up to %i characters and drops it past that', (key, max) => {
    expect(allowedHeldCardOptions({ [key]: 'x'.repeat(max) })).toEqual({
      [key]: 'x'.repeat(max),
    });
    expect(allowedHeldCardOptions({ [key]: 'x'.repeat(max + 1) })).toBeNull();
  });

  it('drops values that are not strings', () => {
    expect(
      allowedHeldCardOptions({ deckName: 'Biology', cloze: true, tags: ['a'] })
    ).toEqual({ deckName: 'Biology' });
  });

  it.each([[null], [undefined], ['text'], [['a']], [{}]])(
    'holds nothing for %j',
    (input) => {
      expect(allowedHeldCardOptions(input)).toBeNull();
    }
  );
});
