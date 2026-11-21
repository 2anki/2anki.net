import { describe, expect, it } from 'vitest';
import type { LandingCopy } from '../../pages/LandingPage/types';
import { routeDocumentLanguage } from './routeLanguage';

const landingCopies = import.meta.glob<{ default: LandingCopy }>(
  '../../pages/LandingPage/copy/*.ts',
  { eager: true }
);

describe('routeDocumentLanguage', () => {
  it.each([
    ['/pdf-zu-anki', 'en', 'de'],
    ['/notion-zu-anki/', 'ja', 'de'],
    ['/powerpoint-zu-anki', 'de', 'de'],
    ['/documentation/reference/terms', 'de', 'en'],
    ['/documentation/reference/privacy/', 'ja', 'en'],
    ['/documentation/misc/terms-of-service', 'de', 'en'],
    ['/documentation/misc/privacy-policy', 'fr', 'en'],
    ['/documentation/start-here/upload-a-file', 'ja', 'en'],
    ['/documentation/start-here/upload-a-file', 'de', null],
    ['/documentation', 'ja', null],
    ['/debug', 'ja', 'en'],
    ['/ops', 'de', 'en'],
    ['/ops/growth', 'ja', 'en'],
    ['/opsx', 'ja', null],
    ['/upload', 'ja', null],
    ['/', 'de', null],
  ])('maps %s under %s to %s', (pathname, appLanguage, expected) => {
    expect(routeDocumentLanguage(pathname, appLanguage)).toBe(expected);
  });

  it('holds every landing page that declares its own language', () => {
    const declared = Object.values(landingCopies)
      .map((module) => module.default)
      .filter((copy) => copy?.htmlLang != null);
    expect(declared.length).toBeGreaterThan(0);
    for (const copy of declared) {
      expect(routeDocumentLanguage(copy.pathname, 'en')).toBe(copy.htmlLang);
    }
  });
});
