import { describe, expect, it } from 'vitest';
import {
  LEGACY_DEFAULT_USER_INSTRUCTIONS,
  normalizeStoredInstructions,
} from './CardOptionsForm';

describe('normalizeStoredInstructions', () => {
  it('returns an empty string when nothing is stored', () => {
    expect(normalizeStoredInstructions(null)).toBe('');
    expect(normalizeStoredInstructions(undefined)).toBe('');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeStoredInstructions('   \n ')).toBe('');
  });

  it('collapses a stored copy of the old default to empty', () => {
    expect(normalizeStoredInstructions(LEGACY_DEFAULT_USER_INSTRUCTIONS)).toBe(
      ''
    );
  });

  it('collapses the old default to empty even with changed whitespace', () => {
    const reflowed = LEGACY_DEFAULT_USER_INSTRUCTIONS.replace(/\n/g, '\n  ');
    expect(normalizeStoredInstructions(reflowed)).toBe('');
  });

  it('keeps real instructions unchanged', () => {
    const custom = 'Make a separate card for each list item.';
    expect(normalizeStoredInstructions(custom)).toBe(custom);
  });
});
