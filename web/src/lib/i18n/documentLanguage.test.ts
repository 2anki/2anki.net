// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY, initI18n } from './index';
import {
  documentLanguageWeSet,
  pinDocumentLanguage,
  setRouteDocumentLanguage,
} from './documentLanguage';

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

function recordLanguageWrites(): () => string[] {
  const root = document.documentElement;
  const observer = new MutationObserver(() => {});
  observer.observe(root, {
    attributeFilter: ['lang'],
    attributeOldValue: true,
  });
  return () => {
    const records = observer.takeRecords();
    observer.disconnect();
    return [...records.map((record) => record.oldValue ?? ''), root.lang];
  };
}

function resetDocument() {
  localStorage.clear();
  setNavigatorLanguage('en-US');
  window.history.replaceState({}, '', '/');
  setRouteDocumentLanguage(null);
  document.documentElement.lang = 'en';
}

describe('document language at start-up', () => {
  beforeEach(resetDocument);
  afterEach(resetDocument);

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

  it('remembers the language it wrote', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ja');
    startApp();
    expect(documentLanguageWeSet()).toBe('ja');
  });
});

describe('route language at start-up', () => {
  beforeEach(resetDocument);
  afterEach(resetDocument);

  it('never writes en on a German landing page loaded directly with an English app', () => {
    window.history.replaceState({}, '', '/pdf-zu-anki/');
    document.documentElement.lang = 'de';
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    const writes = recordLanguageWrites();

    startApp();

    expect(writes()).not.toContain('en');
    expect(document.documentElement.lang).toBe('de');
  });

  it('keeps the terms page English under a German app', () => {
    window.history.replaceState({}, '', '/documentation/reference/terms');
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    startApp();
    expect(document.documentElement.lang).toBe('en');
  });

  it('keeps a docs page English under a Japanese app', () => {
    window.history.replaceState(
      {},
      '',
      '/documentation/start-here/upload-a-file'
    );
    document.documentElement.lang = 'en';
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ja');
    const writes = recordLanguageWrites();

    startApp();

    expect(writes()).not.toContain('ja');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('pinned document language', () => {
  beforeEach(resetDocument);
  afterEach(resetDocument);

  it('holds the pinned language over the app language until released', async () => {
    const instance = startApp();
    const release = pinDocumentLanguage('de');
    expect(document.documentElement.lang).toBe('de');

    await instance.changeLanguage('ja');
    expect(document.documentElement.lang).toBe('de');

    release();
    expect(document.documentElement.lang).toBe('ja');
  });

  it('lets a page pin win over the route language and hands back to it', () => {
    startApp();
    setRouteDocumentLanguage('en');
    const release = pinDocumentLanguage('de');
    expect(document.documentElement.lang).toBe('de');

    release();
    expect(document.documentElement.lang).toBe('en');
  });
});
