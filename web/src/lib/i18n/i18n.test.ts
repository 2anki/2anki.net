// @vitest-environment jsdom
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY, i18nInitOptions } from './index';

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

async function detectLanguage(): Promise<string> {
  const instance = i18next.createInstance();
  await instance.use(LanguageDetector).init(i18nInitOptions);
  return instance.resolvedLanguage ?? instance.language;
}

describe('i18n language detection', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('resolves a de-DE browser to German with empty storage', async () => {
    localStorage.clear();
    setNavigatorLanguage('de-DE');
    expect(await detectLanguage()).toBe('de');
  });

  it('falls back to English for an unsupported browser language', async () => {
    localStorage.clear();
    setNavigatorLanguage('ko-KR');
    expect(await detectLanguage()).toBe('en');
  });

  it('prefers a stored language over the browser language', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    setNavigatorLanguage('en-US');
    expect(await detectLanguage()).toBe('de');
  });
});
