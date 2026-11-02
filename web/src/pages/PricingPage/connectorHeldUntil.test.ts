import { describe, expect, it } from 'vitest';

import { connectorHeldUntil, formatHeldUntil } from './connectorHeldUntil';

const NOW = new Date('2026-11-02T18:00:00Z');

describe('connectorHeldUntil', () => {
  it.each(['2026-11-09', '2026-11-02'])('keeps %s', (raw) => {
    expect(connectorHeldUntil(raw, NOW)).toBe(raw);
  });

  it.each([
    ['a past day', '2026-11-01'],
    ['no value', null],
    ['an empty value', ''],
    ['a timestamp', '2026-11-09T00:00:00Z'],
    ['an impossible day', '2026-02-30'],
    ['text', 'soon'],
  ])('ignores %s', (_label, raw) => {
    expect(connectorHeldUntil(raw, NOW)).toBeNull();
  });
});

describe('formatHeldUntil', () => {
  it.each([
    ['en', 'November 9'],
    ['de', '9. November'],
    ['ja', '11月9日'],
  ])('formats the day in %s', (language, expected) => {
    expect(formatHeldUntil('2026-11-09', language)).toBe(expected);
  });

  it('keeps the calendar day whatever the browser time zone', () => {
    expect(formatHeldUntil('2026-11-01', 'en')).toBe('November 1');
  });
});
