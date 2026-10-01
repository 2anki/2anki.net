import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { purchaseConflictMessage } from './purchaseConflictMessage';

const echoT = ((key: string, opts?: { date?: string }) =>
  opts?.date != null ? `${key}::${opts.date}` : key) as unknown as TFunction;

describe('purchaseConflictMessage', () => {
  it('uses the dated key and formats the expiry for an active pass', () => {
    const result = purchaseConflictMessage(
      echoT,
      { code: 'pass_still_active', expiresAt: '2026-10-08T12:00:00.000Z' },
      'en'
    );

    expect(result).toMatch(
      /^common:checkout\.conflict\.pass_still_active_until::/
    );
    expect(result).toContain('2026');
  });

  it('uses the dated key for an active unlimited pass', () => {
    const result = purchaseConflictMessage(
      echoT,
      { code: 'already_unlimited', expiresAt: '2026-10-08T12:00:00.000Z' },
      'en'
    );

    expect(result).toMatch(
      /^common:checkout\.conflict\.already_unlimited_until::/
    );
  });

  it('falls back to the plain key when a pass has no expiry', () => {
    const result = purchaseConflictMessage(
      echoT,
      { code: 'pass_still_active', expiresAt: null },
      'en'
    );

    expect(result).toBe('common:checkout.conflict.pass_still_active');
  });

  it('falls back to the plain key when the expiry is unparseable', () => {
    const result = purchaseConflictMessage(
      echoT,
      { code: 'already_unlimited', expiresAt: 'not-a-date' },
      'en'
    );

    expect(result).toBe('common:checkout.conflict.already_unlimited');
  });

  it('uses the plain key for ongoing plans that carry no expiry', () => {
    expect(
      purchaseConflictMessage(echoT, {
        code: 'already_subscribed',
        expiresAt: null,
      })
    ).toBe('common:checkout.conflict.already_subscribed');
    expect(
      purchaseConflictMessage(echoT, {
        code: 'already_lifetime',
        expiresAt: null,
      })
    ).toBe('common:checkout.conflict.already_lifetime');
    expect(
      purchaseConflictMessage(echoT, {
        code: 'billed_through_apple',
        expiresAt: null,
      })
    ).toBe('common:checkout.conflict.billed_through_apple');
  });
});
