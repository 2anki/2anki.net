import { stripLeadingDeckNumbering } from './stripLeadingDeckNumbering';

describe('stripLeadingDeckNumbering', () => {
  it.each([
    ['3. Cell Biology', 'Cell Biology'],
    ['03 - Intro', 'Intro'],
    ['12) Lipids', 'Lipids'],
    ['1) Overview', 'Overview'],
    ['  7 . Spaced Separator', 'Spaced Separator'],
    ['4 – En Dash Section', 'En Dash Section'],
    ['10. 5 reasons to sleep', '5 reasons to sleep'],
  ])('strips ordinal numbering from %p', (input, expected) => {
    expect(stripLeadingDeckNumbering(input)).toBe(expected);
  });

  it.each([
    ['3D Anatomy'],
    ['5 Love Languages'],
    ['3 Idiots'],
    ['24: Legacy'],
    ['3.5 Cell Membrane'],
    ['3-5 Overlap'],
    ['Cell Biology'],
    ['IV Fluids'],
  ])('leaves %p unchanged', (input) => {
    expect(stripLeadingDeckNumbering(input)).toBe(input);
  });

  it('keeps the original when stripping would leave an empty name', () => {
    expect(stripLeadingDeckNumbering('1.')).toBe('1.');
    expect(stripLeadingDeckNumbering('42) ')).toBe('42) ');
  });

  it('returns an empty string unchanged', () => {
    expect(stripLeadingDeckNumbering('')).toBe('');
  });
});
