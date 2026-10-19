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
});
