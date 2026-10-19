import { getDefaultUserInstructions } from '../../../../infrastracture/adapters/fileConversion/convertPDFToHTML';
import { normalizeUserInstructions } from './normalizeUserInstructions';

describe('normalizeUserInstructions', () => {
  it('returns undefined when the value is absent', () => {
    expect(normalizeUserInstructions(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(normalizeUserInstructions('')).toBeUndefined();
  });

  it('returns undefined for whitespace only', () => {
    expect(normalizeUserInstructions('   \n\t ')).toBeUndefined();
  });

  it('treats the old default instructions as empty', () => {
    expect(
      normalizeUserInstructions(getDefaultUserInstructions())
    ).toBeUndefined();
  });

  it('treats the old default as empty even with changed whitespace', () => {
    const reflowed = getDefaultUserInstructions()
      .replace(/\n/g, '\n  ')
      .replace(/ - /g, '  -  ');
    expect(normalizeUserInstructions(reflowed)).toBeUndefined();
  });

  it('keeps real instructions, trimmed', () => {
    expect(normalizeUserInstructions('  Make one card per list item.  ')).toBe(
      'Make one card per list item.'
    );
  });

  it('strips the old default when a line is appended on top', () => {
    const withChip = `${getDefaultUserInstructions()}\nMake a separate card for each list item.`;
    expect(normalizeUserInstructions(withChip)).toBe(
      'Make a separate card for each list item.'
    );
  });

  it('strips a reflowed old default and keeps the appended line', () => {
    const reflowed = getDefaultUserInstructions().replace(/\n/g, '\n  ');
    const withChip = `${reflowed}\nWrite multiple-choice questions.`;
    expect(normalizeUserInstructions(withChip)).toBe(
      'Write multiple-choice questions.'
    );
  });

  it('keeps instructions that merely mention the old wording', () => {
    const value = 'Do not make up any questions and keep answers short.';
    expect(normalizeUserInstructions(value)).toBe(value);
  });
});
