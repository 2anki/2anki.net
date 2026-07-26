import { buildAppliedOptions, hasClozeMarkup } from './buildAppliedOptions';

describe('buildAppliedOptions', () => {
  it('projects honored options into the public vocabulary', () => {
    const { applied, ignored } = buildAppliedOptions(
      {
        noteType: 'basic-reversed',
        tags: [' bio ', '', 'cells'],
        deckName: '  Cell biology  ',
        splitByHeadings: true,
        styleTemplate: 'nostyle',
        tts: { enabled: true, language: ' ja-JP ', side: 'back' },
      },
      false
    );

    expect(applied).toEqual({
      noteType: 'basic-reversed',
      tags: ['bio', 'cells'],
      deckName: 'Cell biology',
      splitByHeadings: true,
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
      splitByHeadings: false,
      tts: { enabled: false },
    });
    expect(ignored).toBeUndefined();
  });

  it('treats splitSectionsIntoDecks as splitByHeadings', () => {
    const { applied } = buildAppliedOptions(
      { splitSectionsIntoDecks: true },
      false
    );
    expect(applied.splitByHeadings).toBe(true);
  });

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
