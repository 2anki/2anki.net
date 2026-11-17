import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ParserRules from './ParserRules';

function readRulesPageFlashcardOptions(): string[] {
  const source = readFileSync(
    join(__dirname, '../../../web/src/pages/RulesPage/RulesPage.tsx'),
    'utf8'
  );
  const block = /const flashCardOptions = \[([^\]]*)\];/.exec(source);
  if (block == null) {
    throw new Error('flashCardOptions not found in RulesPage.tsx');
  }
  return Array.from(block[1].matchAll(/'([a-z0-9_]+)'/g), (m) => m[1]);
}

describe('ParserRules.FLASHCARD_TYPE_ALLOWLIST', () => {
  it('matches the flashcard types the Rules page offers', () => {
    expect([...ParserRules.FLASHCARD_TYPE_ALLOWLIST].sort()).toEqual(
      readRulesPageFlashcardOptions().sort()
    );
  });
});

describe('ParserRules.setDeckTypes', () => {
  it('replaces DECK with the provided types', () => {
    const rules = new ParserRules();
    rules.setDeckTypes(['page']);
    expect(rules.DECK).toEqual(['page']);
    expect(rules.permitsDeckAsPage()).toBe(true);
  });

  it('keeps database when only database is selected', () => {
    const rules = new ParserRules();
    rules.setDeckTypes(['database']);
    expect(rules.DECK).toEqual(['database']);
    expect(rules.permitsDeckAsPage()).toBe(false);
  });

  it('throws when given an empty array', () => {
    const rules = new ParserRules();
    expect(() => rules.setDeckTypes([])).toThrow();
    expect(rules.DECK).toEqual(['page', 'database']);
  });

  it('accepts the re-enabled non-page deck types', () => {
    const rules = new ParserRules();
    rules.setDeckTypes(['page', 'database', 'toggle', 'heading_1']);
    expect(rules.DECK).toEqual(['page', 'database', 'toggle', 'heading_1']);
  });

  it('throws on unknown block types', () => {
    const rules = new ParserRules();
    expect(() => rules.setDeckTypes(['page', 'made_up_type'])).toThrow();
    expect(rules.DECK).toEqual(['page', 'database']);
  });

  it('dedupes while preserving order', () => {
    const rules = new ParserRules();
    rules.setDeckTypes(['database', 'page', 'database']);
    expect(rules.DECK).toEqual(['database', 'page']);
  });

  it('default DECK contains page and database', () => {
    const rules = new ParserRules();
    expect(rules.DECK).toEqual(['page', 'database']);
  });

  it('exposes the allowlist including the re-enabled types', () => {
    expect(ParserRules.DECK_TYPE_ALLOWLIST).toEqual([
      'page',
      'database',
      'child_page',
      'child_database',
      'toggle',
      'heading_1',
      'heading_2',
      'heading_3',
      'bulleted_list_item',
      'numbered_list_item',
      'quote',
      'column_list',
    ]);
  });
});

describe('ParserRules.deckTypes', () => {
  it('returns the current DECK selection', () => {
    const rules = new ParserRules();
    expect(rules.deckTypes()).toEqual(['page', 'database']);
    rules.setDeckTypes(['page', 'database', 'toggle']);
    expect(rules.deckTypes()).toEqual(['page', 'database', 'toggle']);
  });
});
