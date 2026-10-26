import CardOption from './CardOption';
import { getDefaultUserInstructions } from '../../../infrastracture/adapters/fileConversion/convertPDFToHTML';

describe('CardOption userInstructions', () => {
  it('is undefined when no instructions are posted', () => {
    expect(new CardOption({}).userInstructions).toBeUndefined();
  });

  it('does not fall back to the old PDF-to-HTML default', () => {
    expect(new CardOption({}).userInstructions).not.toBe(
      getDefaultUserInstructions()
    );
  });

  it('treats a stored copy of the old default as empty', () => {
    const option = new CardOption({
      'user-instructions': getDefaultUserInstructions(),
    });
    expect(option.userInstructions).toBeUndefined();
  });

  it('keeps real instructions, trimmed', () => {
    const option = new CardOption({
      'user-instructions': '  Make one card per list item.  ',
    });
    expect(option.userInstructions).toBe('Make one card per list item.');
  });

  it('keeps only the line a user added on top of the old default', () => {
    const option = new CardOption({
      'user-instructions': `${getDefaultUserInstructions()}\nMake a separate card for each list item.`,
    });
    expect(option.userInstructions).toBe(
      'Make a separate card for each list item.'
    );
  });
});

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

describe('CardOption pdfPageRange', () => {
  it('defaults to an empty string when the option is absent', () => {
    const option = new CardOption({});
    expect(option.pdfPageRange).toBe('');
  });

  it('reads the raw range string from the payload', () => {
    const option = new CardOption({ 'pdf-page-range': '12-30, 45' });
    expect(option.pdfPageRange).toBe('12-30, 45');
  });

  it('ships pdf-page-range as empty in the default options payload', () => {
    expect(CardOption.LoadDefaultOptions()['pdf-page-range']).toBe('');
  });

  it('coerces a non-string pdf-page-range to empty', () => {
    const option = new CardOption({
      'pdf-page-range': ['12-30'],
    } as unknown as { [key: string]: string });
    expect(option.pdfPageRange).toBe('');
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

describe('CardOption pdfFallback', () => {
  it.each([
    [undefined, 'pairs'],
    ['', 'pairs'],
    ['ask', 'ask'],
    ['single', 'single'],
    ['pairs', 'pairs'],
    ['toString', 'pairs'],
    ['SINGLE', 'pairs'],
  ])('reads %s as %s', (raw, expected) => {
    const input: Record<string, string> =
      raw === undefined ? {} : { 'pdf-fallback': raw };
    expect(new CardOption(input).pdfFallback).toBe(expected);
  });
});
