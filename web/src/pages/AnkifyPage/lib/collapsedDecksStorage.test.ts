// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getStoredCollapsedDecks,
  setStoredCollapsedDecks,
} from './collapsedDecksStorage';

describe('collapsedDecksStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns an empty set when nothing is stored', () => {
    expect(getStoredCollapsedDecks()).toEqual(new Set());
  });

  it('round-trips a set of collapsed deck names', () => {
    setStoredCollapsedDecks(new Set(['MS3::Pharmacology', 'MS3::Anatomy']));
    expect(getStoredCollapsedDecks()).toEqual(
      new Set(['MS3::Pharmacology', 'MS3::Anatomy'])
    );
  });

  it('returns an empty set for corrupted stored JSON', () => {
    localStorage.setItem('2anki-ankify-collapsed-decks', 'not json');
    expect(getStoredCollapsedDecks()).toEqual(new Set());
  });

  it('ignores non-string entries in a malformed stored array', () => {
    localStorage.setItem(
      '2anki-ankify-collapsed-decks',
      JSON.stringify(['MS3::Pharmacology', 42, null])
    );
    expect(getStoredCollapsedDecks()).toEqual(new Set(['MS3::Pharmacology']));
  });
});
