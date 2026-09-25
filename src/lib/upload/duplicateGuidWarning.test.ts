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
      "1 card is an exact duplicate of another card in this deck — same question and answer. Anki keeps one, so you import 1 card fewer than you see here. If it wasn't meant to repeat, remove it and convert again."
    );
  });

  it('renders several cards in the plural', () => {
    expect(duplicateGuidWarningText(3)).toBe(
      "3 cards are exact duplicates of other cards in this deck — same question and answer. Anki keeps one of each, so you import 3 cards fewer than you see here. If they weren't meant to repeat, remove them and convert again."
    );
  });
});
