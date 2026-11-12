import { describe, expect, it } from 'vitest';

import { changelog } from './index';

describe('changelog loader', () => {
  it('loads at least one entry from the per-file JSON store', () => {
    expect(changelog.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = new Set<string>();
    for (const entry of changelog) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
    }
  });

  it('sorts by id descending', () => {
    for (let i = 1; i < changelog.length; i += 1) {
      expect(changelog[i - 1].id >= changelog[i].id).toBe(true);
    }
  });

  it('every entry has a valid date and type', () => {
    const validTypes = new Set(['feature', 'fix', 'style']);
    for (const entry of changelog) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(validTypes.has(entry.type)).toBe(true);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it('no longer lists the removed confirm-email card', () => {
    expect(changelog.map((entry) => entry.id)).not.toContain(
      '2026-10-09-confirm-email-at-first-deck'
    );
  });
});
