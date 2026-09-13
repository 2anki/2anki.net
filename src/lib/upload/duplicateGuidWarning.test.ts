import {
  duplicateGuidWarning,
  duplicateGuidWarningText,
} from './duplicateGuidWarning';

describe('duplicateGuidWarning', () => {
  it('is silent when no note shares a guid', () => {
    expect(duplicateGuidWarning(0)).toBeNull();
  });

  it('codes the number of notes Anki will drop', () => {
    expect(duplicateGuidWarning(2)).toBe('duplicate-guid:2');
  });

  it('renders one card in the singular', () => {
    expect(duplicateGuidWarningText(1)).toBe(
      '1 card repeats the question of another card in the same deck, so Anki keeps only the first. You import 1 card fewer than you see here. Give it a different question and convert again.'
    );
  });

  it('renders several cards in the plural', () => {
    expect(duplicateGuidWarningText(3)).toBe(
      '3 cards repeat the question of another card in the same deck, so Anki keeps only the first of each. You import 3 cards fewer than you see here. Make the repeated questions different and convert again.'
    );
  });
});
