// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  DECK_SORT_DEFAULT,
  DeckSortRow,
  isDeckSortKey,
  readStoredDeckSort,
  sortDecks,
  writeStoredDeckSort,
} from './deckSort';

const row = (overrides: Partial<DeckSortRow> = {}): DeckSortRow => ({
  notion_page_title: 'A deck',
  last_synced_at: '2026-06-01T00:00:00.000Z',
  last_error: null,
  ...overrides,
});

const titles = (rows: DeckSortRow[], key: Parameters<typeof sortDecks>[1]) =>
  sortDecks(rows, key).map((r) => r.notion_page_title);

describe('sortDecks — status', () => {
  test('orders failed before syncing before offline before healthy', () => {
    const healthy = row({ notion_page_title: 'healthy', last_error: null });
    const offline = row({
      notion_page_title: 'offline',
      last_error: 'Anki client offline — will retry next tick',
    });
    const failed = row({ notion_page_title: 'failed', last_error: 'boom' });
    expect(titles([healthy, offline, failed], 'status')).toEqual([
      'failed',
      'offline',
      'healthy',
    ]);
  });

  test('tiebreaks within a status by oldest synced first', () => {
    const older = row({
      notion_page_title: 'older',
      last_error: null,
      last_synced_at: '2026-01-01T00:00:00.000Z',
    });
    const newer = row({
      notion_page_title: 'newer',
      last_error: null,
      last_synced_at: '2026-06-01T00:00:00.000Z',
    });
    expect(titles([newer, older], 'status')).toEqual(['older', 'newer']);
  });

  test('never-synced rows sort after synced rows within the same status', () => {
    const never = row({
      notion_page_title: 'never',
      last_error: null,
      last_synced_at: null,
    });
    const synced = row({
      notion_page_title: 'synced',
      last_error: null,
      last_synced_at: '2026-01-01T00:00:00.000Z',
    });
    expect(titles([never, synced], 'status')).toEqual(['synced', 'never']);
  });
});

describe('sortDecks — last-synced', () => {
  test('orders newest synced first', () => {
    const old = row({
      notion_page_title: 'old',
      last_synced_at: '2026-01-01T00:00:00.000Z',
    });
    const recent = row({
      notion_page_title: 'recent',
      last_synced_at: '2026-06-01T00:00:00.000Z',
    });
    expect(titles([old, recent], 'last-synced')).toEqual(['recent', 'old']);
  });

  test('never-synced (null last_synced_at) sorts last', () => {
    const never = row({ notion_page_title: 'never', last_synced_at: null });
    const synced = row({
      notion_page_title: 'synced',
      last_synced_at: '2026-06-01T00:00:00.000Z',
    });
    expect(titles([never, synced], 'last-synced')).toEqual(['synced', 'never']);
  });
});

describe('sortDecks — name', () => {
  test('locale-aware A→Z, case-insensitive', () => {
    const rows = [
      row({ notion_page_title: 'banana' }),
      row({ notion_page_title: 'Apple' }),
      row({ notion_page_title: 'cherry' }),
    ];
    expect(titles(rows, 'name')).toEqual(['Apple', 'banana', 'cherry']);
  });

  test('"Untitled page" sorts last, not under U', () => {
    const rows = [
      row({ notion_page_title: 'Zebra' }),
      row({ notion_page_title: null }),
      row({ notion_page_title: 'Apple' }),
    ];
    expect(titles(rows, 'name')).toEqual(['Apple', 'Zebra', null]);
  });

  test('empty/whitespace title is treated as untitled and sorts last', () => {
    const rows = [
      row({ notion_page_title: '   ' }),
      row({ notion_page_title: 'Apple' }),
    ];
    expect(titles(rows, 'name')).toEqual(['Apple', '   ']);
  });
});

describe('sortDecks — edge cases', () => {
  test('empty list returns empty', () => {
    expect(sortDecks([], 'status')).toEqual([]);
  });

  test('does not mutate the input array', () => {
    const rows = [
      row({ notion_page_title: 'b' }),
      row({ notion_page_title: 'a' }),
    ];
    const snapshot = rows.map((r) => r.notion_page_title);
    sortDecks(rows, 'name');
    expect(rows.map((r) => r.notion_page_title)).toEqual(snapshot);
  });
});

describe('isDeckSortKey', () => {
  test.each(['status', 'last-synced', 'name'])('accepts %s', (value) => {
    expect(isDeckSortKey(value)).toBe(true);
  });

  test.each(['cards', '', null, undefined, 42])('rejects %s', (value) => {
    expect(isDeckSortKey(value)).toBe(false);
  });
});

describe('persistence', () => {
  beforeEach(() => globalThis.localStorage?.clear());
  afterEach(() => vi.restoreAllMocks());

  test('reads a stored valid key', () => {
    writeStoredDeckSort('name');
    expect(readStoredDeckSort()).toBe('name');
  });

  test('unknown stored value falls back to default', () => {
    globalThis.localStorage?.setItem('ankify-deck-sort', 'bogus');
    expect(readStoredDeckSort()).toBe(DECK_SORT_DEFAULT);
  });

  test('absent value falls back to default', () => {
    expect(readStoredDeckSort()).toBe(DECK_SORT_DEFAULT);
  });

  test('read survives a throwing localStorage', () => {
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStoredDeckSort()).toBe(DECK_SORT_DEFAULT);
  });
});
