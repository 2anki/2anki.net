import { describe, expect, it } from 'vitest';

const accountx = import.meta.glob('./locales/*/accountx.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

function magicLink(lang: string): Record<string, unknown> {
  return accountx[`./locales/${lang}/accountx.json`].default
    .magicLink as Record<string, unknown>;
}

describe('magic-link confirm step i18n key parity', () => {
  it.each(LANGS)(
    '%s names the masked address in both confirm titles',
    (lang) => {
      const keys = magicLink(lang);
      for (const key of ['confirmLoginTitle', 'confirmResetTitle']) {
        expect(keys[key]).toEqual(expect.stringContaining('{{email}}'));
      }
    }
  );

  it.each(LANGS)(
    '%s defines both hints, both buttons, the retry notice, the busy label, and the open-failure copy',
    (lang) => {
      const keys = magicLink(lang);
      for (const key of [
        'confirmLoginHint',
        'confirmResetHint',
        'confirmRetry',
        'unavailableTitle',
        'tryAgain',
        'confirmLoginButton',
        'confirmResetButton',
        'confirming',
      ]) {
        expect(keys[key]).toEqual(expect.stringMatching(/\S/));
      }
    }
  );

  it.each(LANGS.filter((lang) => lang !== 'en'))(
    '%s translates the expired-link sentence',
    (lang) => {
      expect(magicLink(lang).invalidOrExpired).not.toBe(
        magicLink('en').invalidOrExpired
      );
    }
  );

  it('keeps the 2anki name verbatim in every sign-in confirm title', () => {
    for (const lang of LANGS) {
      expect(magicLink(lang).confirmLoginTitle).toEqual(
        expect.stringContaining('2anki')
      );
    }
  });
});
