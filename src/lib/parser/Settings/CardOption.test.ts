import CardOption from './CardOption';

describe('CardOption rescueRule', () => {
  it('is undefined when the option is absent', () => {
    expect(new CardOption({}).rescueRule).toBeUndefined();
  });

  it('reads a known rule from the payload', () => {
    expect(new CardOption({ 'rescue-rule': 'bullets' }).rescueRule).toBe(
      'bullets'
    );
  });

  it('drops a value outside the rule vocabulary', () => {
    expect(new CardOption({ 'rescue-rule': 'toString' }).rescueRule).toBe(
      undefined
    );
  });
});

describe('CardOption codeTheme', () => {
  it('defaults to github when the option is absent', () => {
    const option = new CardOption({});
    expect(option.codeTheme).toBe('github');
  });

  it('reads a known theme from the payload', () => {
    const option = new CardOption({ 'code-theme': 'dracula' });
    expect(option.codeTheme).toBe('dracula');
  });

  it('falls back to github for an unknown theme', () => {
    const option = new CardOption({ 'code-theme': 'not-a-theme' });
    expect(option.codeTheme).toBe('github');
  });

  it('ships code-theme in the default options payload', () => {
    expect(CardOption.LoadDefaultOptions()['code-theme']).toBe('github');
  });
});

describe('CardOption downloadPdfs', () => {
  it('defaults to false when the option is absent', () => {
    const option = new CardOption({});
    expect(option.downloadPdfs).toBe(false);
  });

  it('reads true from the payload', () => {
    const option = new CardOption({ 'download-pdfs': 'true' });
    expect(option.downloadPdfs).toBe(true);
  });

  it('ships download-pdfs as false in the default options payload', () => {
    expect(CardOption.LoadDefaultOptions()['download-pdfs']).toBe('false');
  });
});

describe('CardOption groupClozePerToggle', () => {
  it('defaults to false when the option is absent', () => {
    const option = new CardOption({});
    expect(option.groupClozePerToggle).toBe(false);
  });

  it('reads true from the payload', () => {
    const option = new CardOption({ 'group-cloze-per-toggle': 'true' });
    expect(option.groupClozePerToggle).toBe(true);
  });

  it('ships group-cloze-per-toggle as false in the default options payload', () => {
    expect(CardOption.LoadDefaultOptions()['group-cloze-per-toggle']).toBe(
      'false'
    );
  });
});
