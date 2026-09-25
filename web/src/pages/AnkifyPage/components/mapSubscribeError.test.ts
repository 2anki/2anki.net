import { describe, expect, it } from 'vitest';
import { mapSubscribeError } from './mapSubscribeError';

type StatusError = Error & { status?: number };

const makeError = (message: string, status?: number): StatusError => {
  const e = Object.assign(new Error(message), { status });
  return e;
};

const FALLBACK_KEY = 'subscriptions.subscribeError.fallback';

describe('mapSubscribeError', () => {
  it.each([
    [
      401,
      'anything',
      'subscriptions.subscribeError.notActive',
      '/account',
      'subscriptions.subscribeError.notActiveLink',
    ],
    [
      403,
      'anything',
      'subscriptions.subscribeError.notActive',
      '/account',
      'subscriptions.subscribeError.notActiveLink',
    ],
  ])(
    'status %d → paywall key with manage link',
    (status, message, expectedTextKey, expectedHref, expectedLabelKey) => {
      const result = mapSubscribeError(makeError(message, status));
      expect(result.textKey).toBe(expectedTextKey);
      expect(result.link?.href).toBe(expectedHref);
      expect(result.link?.labelKey).toBe(expectedLabelKey);
    }
  );

  it('409 with NotionNotConnected message → Notion connect key', () => {
    const result = mapSubscribeError(makeError('Notion is not connected', 409));
    expect(result.textKey).toBe(
      'subscriptions.subscribeError.notionDisconnected'
    );
    expect(result.link?.href).toBe('/notion');
    expect(result.link?.labelKey).toBe(
      'subscriptions.subscribeError.notionDisconnectedLink'
    );
  });

  it('409 with NoActiveAnkifyClient message → set up Anki key', () => {
    const result = mapSubscribeError(
      makeError(
        'No active Ankify client. Provision one before subscribing.',
        409
      )
    );
    expect(result.textKey).toBe('subscriptions.subscribeError.noClient');
    expect(result.link?.href).toBe('/ankify/setup');
    expect(result.link?.labelKey).toBe(
      'subscriptions.subscribeError.noClientLink'
    );
  });

  it('409 with unknown message → default fallback (no link)', () => {
    const result = mapSubscribeError(makeError('Some other 409 reason', 409));
    expect(result.textKey).toBe(FALLBACK_KEY);
    expect(result.link).toBeUndefined();
  });

  it('503 → AnkiConnect unreachable key (no link)', () => {
    const result = mapSubscribeError(
      makeError('AnkiConnect is unreachable.', 503)
    );
    expect(result.textKey).toBe('subscriptions.subscribeError.ankiUnreachable');
    expect(result.link).toBeUndefined();
  });

  it('unknown status → default fallback (no link)', () => {
    const result = mapSubscribeError(makeError('network error'));
    expect(result.textKey).toBe(FALLBACK_KEY);
    expect(result.link).toBeUndefined();
  });

  it('500 → default fallback (no link)', () => {
    const result = mapSubscribeError(makeError('internal error', 500));
    expect(result.textKey).toBe(FALLBACK_KEY);
    expect(result.link).toBeUndefined();
  });
});
