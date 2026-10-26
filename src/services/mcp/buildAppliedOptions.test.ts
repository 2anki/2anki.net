import { buildAppliedOptions, hasClozeMarkup } from './buildAppliedOptions';

describe('buildAppliedOptions', () => {
  it('projects honored options into the public vocabulary', () => {
    const { applied, ignored } = buildAppliedOptions(
      {
        noteType: 'basic-reversed',
        tags: [' bio ', '', 'cells'],
        deckName: '  Cell biology  ',
        styleTemplate: 'nostyle',
        tts: { enabled: true, language: ' ja-JP ', side: 'back' },
      },
      false
    );

    expect(applied).toEqual({
      noteType: 'basic-reversed',
      tags: ['bio', 'cells'],
      deckName: 'Cell biology',
      styleTemplate: 'nostyle',
      tts: { enabled: true, language: 'ja-JP', side: 'back' },
    });
    expect(ignored).toBeUndefined();
  });

  it('defaults to basic with empty tags and disabled tts when no options are given', () => {
    const { applied, ignored } = buildAppliedOptions(undefined, false);
    expect(applied).toEqual({
      noteType: 'basic',
      tags: [],
      tts: { enabled: false },
    });
    expect(ignored).toBeUndefined();
  });

  it.each([['splitByHeadings'], ['splitSectionsIntoDecks']] as const)(
    'reports %s under ignored and never on applied',
    (option) => {
      const { applied, ignored } = buildAppliedOptions(
        { [option]: true },
        false
      );
      expect(applied).not.toHaveProperty('splitByHeadings');
      expect(ignored).toEqual([
        {
          option: 'splitByHeadings',
          requested: true,
          reason:
            'Deck splitting is controlled by the deck_is rule on your Rules page, not by this option, so it had no effect.',
        },
      ]);
    }
  );

  it('falls back cloze to basic and records an ignored entry when markup is absent', () => {
    const { applied, ignored } = buildAppliedOptions(
      { noteType: 'cloze' },
      false
    );
    expect(applied.noteType).toBe('basic');
    expect(ignored).toEqual([
      {
        option: 'noteType',
        requested: 'cloze',
        reason:
          'No {{c1::}} markup found in the text; built basic cards instead.',
      },
    ]);
  });

  it('keeps cloze when the markup is present', () => {
    const { applied, ignored } = buildAppliedOptions(
      { noteType: 'cloze' },
      true
    );
    expect(applied.noteType).toBe('cloze');
    expect(ignored).toBeUndefined();
  });

  it('keeps input in applied by default when the typability check is not passed', () => {
    const { applied, ignored } = buildAppliedOptions(
      { noteType: 'input' },
      false
    );
    expect(applied.noteType).toBe('input');
    expect(ignored).toBeUndefined();
  });

  it('keeps input in applied but records an ignored entry when an answer is not typable', () => {
    const { applied, ignored } = buildAppliedOptions(
      { noteType: 'input' },
      false,
      false
    );
    expect(applied.noteType).toBe('input');
    expect(ignored).toEqual([
      {
        option: 'noteType',
        requested: 'input',
        reason:
          'One or more card backs were too long, multi-line, or contained a link/image to type as an answer; those cards built as basic instead.',
      },
    ]);
  });

  it('keeps input with no ignored entry when every answer is typable', () => {
    const { applied, ignored } = buildAppliedOptions(
      { noteType: 'input' },
      false,
      true
    );
    expect(applied.noteType).toBe('input');
    expect(ignored).toBeUndefined();
  });

  it('omits deckName and styleTemplate when they resolve to empty or invalid', () => {
    const { applied } = buildAppliedOptions(
      { deckName: '   ', styleTemplate: 'unknown' as never },
      false
    );
    expect(applied.deckName).toBeUndefined();
    expect(applied.styleTemplate).toBeUndefined();
  });

  it.each([['basic'], ['basic-reversed']] as const)(
    'keeps %s for a CSV or TSV source with no ignored entry',
    (noteType) => {
      const { applied, ignored } = buildAppliedOptions(
        { noteType },
        false,
        true,
        true
      );
      expect(applied.noteType).toBe(noteType);
      expect(ignored).toBeUndefined();
    }
  );

  it.each([['cloze'], ['input'], ['mcq']] as const)(
    'reports %s as ignored and applied as basic for a CSV or TSV source',
    (noteType) => {
      const { applied, ignored } = buildAppliedOptions(
        { noteType },
        true,
        true,
        true
      );
      expect(applied.noteType).toBe('basic');
      expect(ignored).toHaveLength(1);
      expect(ignored?.[0]).toMatchObject({
        option: 'noteType',
        requested: noteType,
      });
      expect(ignored?.[0].reason).toContain('CSV and TSV rows');
    }
  );
});

describe('hasClozeMarkup', () => {
  it('detects cloze markup', () => {
    expect(hasClozeMarkup('The {{c1::mitochondrion}} is the powerhouse')).toBe(
      true
    );
    expect(hasClozeMarkup('The {{c12::term}} example')).toBe(true);
  });

  it('is false for plain text and bare double braces', () => {
    expect(hasClozeMarkup('Mitochondrion :: powerhouse')).toBe(false);
    expect(hasClozeMarkup('{{not a cloze}}')).toBe(false);
  });
});
