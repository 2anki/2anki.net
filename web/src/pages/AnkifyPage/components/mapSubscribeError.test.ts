import { describe, expect, it } from 'vitest';
import { mapSubscribeError } from './mapSubscribeError';

type StatusError = Error & { status?: number };

const makeError = (message: string, status?: number): StatusError => {
  const e = Object.assign(new Error(message), { status });
  return e;
};

describe('mapSubscribeError', () => {
  it.each([
    [
      401,
      'anything',
      "Auto Sync isn't active on this account.",
      '/account',
      'Manage subscription',
    ],
    [
      403,
      'anything',
      "Auto Sync isn't active on this account.",
      '/account',
      'Manage subscription',
    ],
  ])(
    'status %d → paywall copy with manage link',
    (status, message, expectedText, expectedHref, expectedLabel) => {
      const result = mapSubscribeError(makeError(message, status));
      expect(result.text).toBe(expectedText);
      expect(result.link?.href).toBe(expectedHref);
      expect(result.link?.label).toBe(expectedLabel);
    }
  );

  it('409 with NotionNotConnected message → Notion connect copy', () => {
    const result = mapSubscribeError(makeError('Notion is not connected', 409));
    expect(result.text).toBe("Notion isn't connected to 2anki.");
    expect(result.link?.href).toBe('/notion');
    expect(result.link?.label).toBe('Connect Notion');
  });

  it('409 with NoActiveAnkifyClient message → set up Anki copy', () => {
    const result = mapSubscribeError(
      makeError(
        'No active Ankify client. Provision one before subscribing.',
        409
      )
    );
    expect(result.text).toBe("Your hosted Anki isn't set up yet.");
    expect(result.link?.href).toBe('/ankify/setup');
    expect(result.link?.label).toBe('Set up Anki');
  });

  it('409 with unknown message → default fallback (no link)', () => {
    const result = mapSubscribeError(makeError('Some other 409 reason', 409));
    expect(result.text).toBe(
      'Something broke on our end. Try again, or email support@2anki.net.'
    );
    expect(result.link).toBeUndefined();
  });

  it('503 → AnkiConnect unreachable copy (no link)', () => {
    const result = mapSubscribeError(
      makeError('AnkiConnect is unreachable.', 503)
    );
    expect(result.text).toBe(
      "Anki isn't responding right now. Try again in a moment."
    );
    expect(result.link).toBeUndefined();
  });

  it('unknown status → default fallback (no link)', () => {
    const result = mapSubscribeError(makeError('network error'));
    expect(result.text).toBe(
      'Something broke on our end. Try again, or email support@2anki.net.'
    );
    expect(result.link).toBeUndefined();
  });

  it('500 → default fallback (no link)', () => {
    const result = mapSubscribeError(makeError('internal error', 500));
    expect(result.text).toBe(
      'Something broke on our end. Try again, or email support@2anki.net.'
    );
    expect(result.link).toBeUndefined();
  });
});
