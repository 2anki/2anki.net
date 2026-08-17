import {
  getCardStylePromptFragment,
  validateCardStylePicker,
} from './getCardStylePromptFragment';

describe('validateCardStylePicker', () => {
  it('admits heading-driven from the card-style picker', () => {
    expect(validateCardStylePicker('heading-driven')).toBe('heading-driven');
  });

  it('admits cloze and qa', () => {
    expect(validateCardStylePicker('cloze')).toBe('cloze');
    expect(validateCardStylePicker('qa')).toBe('qa');
  });

  it('coerces an unknown value to the empty default', () => {
    expect(validateCardStylePicker('concise')).toBe('');
  });

  it('coerces undefined to the empty default', () => {
    expect(validateCardStylePicker(undefined)).toBe('');
  });
});

describe('getCardStylePromptFragment', () => {
  it('returns a heading-driven fragment for heading-driven style', () => {
    const fragment = getCardStylePromptFragment('heading-driven');
    expect(fragment.length).toBeGreaterThan(0);
    expect(fragment.toLowerCase()).toContain('heading');
    expect(fragment).toContain('2');
    expect(fragment).toContain('6');
  });

  it('returns a cloze fragment for cloze style', () => {
    const fragment = getCardStylePromptFragment('cloze');
    expect(fragment.length).toBeGreaterThan(0);
    expect(fragment.toLowerCase()).toContain('cloze');
  });

  it('tells the model to keep a list on one cloze card', () => {
    const fragment = getCardStylePromptFragment('cloze');
    expect(fragment).toContain('one card per list, not one card per item');
    expect(fragment).toContain('{{c2::...}}');
  });

  it('returns a qa fragment for qa style', () => {
    const fragment = getCardStylePromptFragment('qa');
    expect(fragment.length).toBeGreaterThan(0);
    expect(fragment.toLowerCase()).toContain('question');
  });

  it('returns an empty string for unknown / default style', () => {
    expect(getCardStylePromptFragment(undefined)).toBe('');
  });

  it('returns an empty string for an unrecognised style value', () => {
    expect(getCardStylePromptFragment('concise')).toBe('');
  });
});
