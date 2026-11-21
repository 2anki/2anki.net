// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY, initI18n } from './index';
import { pinDocumentLanguage } from './documentLanguage';

function setNavigatorLanguage(language: string) {
  Object.defineProperty(window.navigator, 'language', {
    value: language,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'languages', {
    value: [language],
    configurable: true,
  });
}

function startApp() {
  return initI18n(i18next.createInstance());
}

describe('document language at start-up', () => {
  beforeEach(() => {
    localStorage.clear();
    setNavigatorLanguage('en-US');
    document.documentElement.lang = 'en';
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it.each(['ja', 'de', 'ru'])(
    'sets the html lang to a stored %s once i18n starts',
    (language) => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      startApp();
      expect(document.documentElement.lang).toBe(language);
    }
  );

  it('uses the fallback language code for an unsupported stored value', () => {
    document.documentElement.lang = 'xx';
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ko');
    startApp();
    expect(document.documentElement.lang).toBe('en');
  });

  it('keeps English as en', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    startApp();
    expect(document.documentElement.lang).toBe('en');
  });

  it('follows a detected browser language when nothing is stored', () => {
    setNavigatorLanguage('de-DE');
    startApp();
    expect(document.documentElement.lang).toBe('de');
  });

  it('follows a later language change', async () => {
    const instance = startApp();
    await instance.changeLanguage('pl');
    expect(document.documentElement.lang).toBe('pl');
  });
});

describe('pinned document language', () => {
  beforeEach(() => {
    localStorage.clear();
    setNavigatorLanguage('en-US');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('holds the pinned language over the app language until released', async () => {
    const instance = startApp();
    const release = pinDocumentLanguage('de');
    expect(document.documentElement.lang).toBe('de');

    await instance.changeLanguage('ja');
    expect(document.documentElement.lang).toBe('de');

    release();
    expect(document.documentElement.lang).toBe('ja');
  });
});
