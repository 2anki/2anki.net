import { mcpOptionsToCardSettings } from './mcpOptionsToCardSettings';

describe('mcpOptionsToCardSettings', () => {
  it('returns an empty bag when no options are given', () => {
    expect(mcpOptionsToCardSettings(undefined)).toEqual({});
    expect(mcpOptionsToCardSettings({})).toEqual({});
  });

  it('maps noteType basic to cloze off', () => {
    expect(mcpOptionsToCardSettings({ noteType: 'basic' })).toEqual({
      cloze: 'false',
    });
  });

  it('maps noteType basic-reversed to the reversed flag with cloze off', () => {
    expect(mcpOptionsToCardSettings({ noteType: 'basic-reversed' })).toEqual({
      cloze: 'false',
      'basic-reversed': 'true',
    });
  });

  it('maps noteType cloze to cloze on', () => {
    expect(mcpOptionsToCardSettings({ noteType: 'cloze' })).toEqual({
      cloze: 'true',
    });
  });

  it('maps noteType input to the input flag with cloze off', () => {
    expect(mcpOptionsToCardSettings({ noteType: 'input' })).toEqual({
      cloze: 'false',
      'enable-input': 'true',
    });
  });

  it('maps noteType mcq to the mcq flag with cloze off', () => {
    expect(mcpOptionsToCardSettings({ noteType: 'mcq' })).toEqual({
      cloze: 'false',
      'mcq-enabled': 'true',
    });
  });

  it('ignores an unknown noteType', () => {
    expect(
      mcpOptionsToCardSettings({
        noteType: 'diagram' as unknown as 'basic',
      })
    ).toEqual({});
  });

  it('joins non-empty tags into the global-tags key', () => {
    expect(
      mcpOptionsToCardSettings({ tags: ['  pharmacology ', '', 'exam-2'] })
    ).toEqual({ 'global-tags': 'pharmacology,exam-2' });
  });

  it('omits global-tags when the array is empty or all blank', () => {
    expect(mcpOptionsToCardSettings({ tags: [] })).toEqual({});
    expect(mcpOptionsToCardSettings({ tags: ['   ', ''] })).toEqual({});
  });

  it('passes deckName through and ignores a blank one', () => {
    expect(mcpOptionsToCardSettings({ deckName: 'MS3::Cardio' })).toEqual({
      deckName: 'MS3::Cardio',
    });
    expect(mcpOptionsToCardSettings({ deckName: '   ' })).toEqual({});
  });

  it('does not write the retired split key for splitByHeadings or splitSectionsIntoDecks', () => {
    expect(mcpOptionsToCardSettings({ splitByHeadings: true })).toEqual({});
    expect(mcpOptionsToCardSettings({ splitSectionsIntoDecks: true })).toEqual(
      {}
    );
  });

  it('maps a known styleTemplate and ignores an unknown one', () => {
    expect(mcpOptionsToCardSettings({ styleTemplate: 'nostyle' })).toEqual({
      template: 'nostyle',
    });
    expect(
      mcpOptionsToCardSettings({
        styleTemplate: 'neon' as unknown as 'nostyle',
      })
    ).toEqual({});
  });

  it('maps tts with a language to manual language and side', () => {
    expect(
      mcpOptionsToCardSettings({
        tts: { enabled: true, language: 'ja-JP', side: 'both' },
      })
    ).toEqual({ 'tts-manual-lang': 'ja-JP', 'tts-manual-side': 'both' });
  });

  it('maps tts without a language to auto-detect', () => {
    expect(mcpOptionsToCardSettings({ tts: { enabled: true } })).toEqual({
      'tts-auto-detect': 'true',
    });
  });

  it('ignores tts when disabled', () => {
    expect(
      mcpOptionsToCardSettings({ tts: { enabled: false, language: 'de' } })
    ).toEqual({});
  });

  it('ignores an invalid tts side', () => {
    expect(
      mcpOptionsToCardSettings({
        tts: { enabled: true, side: 'top' as unknown as 'front' },
      })
    ).toEqual({ 'tts-auto-detect': 'true' });
  });

  it('composes several options into one bag', () => {
    expect(
      mcpOptionsToCardSettings({
        noteType: 'cloze',
        tags: ['bio'],
        deckName: 'Bio',
        styleTemplate: 'specialstyle',
        tts: { enabled: true, language: 'en-US' },
      })
    ).toEqual({
      cloze: 'true',
      'global-tags': 'bio',
      deckName: 'Bio',
      template: 'specialstyle',
      'tts-manual-lang': 'en-US',
    });
  });
});
