import { describe, expect, it } from 'vitest';
import { formatCreditPackExpiry } from './formatCreditPackExpiry';

describe('formatCreditPackExpiry', () => {
  it('formats a date 90 days out from the given moment', () => {
    const now = new Date('2026-09-16T12:00:00.000Z');
    expect(formatCreditPackExpiry('en-US', now)).toBe('December 15, 2026');
  });

  it('honours the requested locale', () => {
    const now = new Date('2026-09-16T12:00:00.000Z');
    expect(formatCreditPackExpiry('de-DE', now)).toBe('15. Dezember 2026');
  });
});
