import { describe, expect, it } from 'vitest';

const common = import.meta.glob('./locales/*/common.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

function loginKeys(lang: string): Record<string, unknown> {
  const auth = common[`./locales/${lang}/common.json`].default.auth as Record<
    string,
    Record<string, unknown>
  >;
  return auth.login;
}

describe('login password-error i18n key parity', () => {
  it.each(LANGS.filter((lang) => lang !== 'en'))(
    '%s translates both password-error sentences',
    (lang) => {
      for (const key of ['wrongCredentials', 'googleAccountHint']) {
        expect(loginKeys(lang)[key]).toEqual(expect.stringMatching(/\S/));
        expect(loginKeys(lang)[key]).not.toBe(loginKeys('en')[key]);
      }
    }
  );

  it.each(LANGS)(
    '%s keeps the Google OAuth label verbatim in the hint',
    (lang) => {
      expect(loginKeys(lang).googleAccountHint).toEqual(
        expect.stringContaining('Sign in with Google')
      );
    }
  );
});
