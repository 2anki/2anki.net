import i18n, {
  type i18n as I18n,
  type InitOptions,
  type Resource,
} from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  FALLBACK_LANGUAGE,
  followAppLanguage,
  setRouteDocumentLanguage,
} from './documentLanguage';
import { routeDocumentLanguage } from './routeLanguage';

export const SUPPORTED_LANGUAGES = [
  'en',
  'de',
  'es',
  'ja',
  'fr',
  'pt',
  'ru',
  'it',
  'nl',
  'pl',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Native language names (endonyms) shown in the picker. Endonyms are the same
// regardless of the viewer's language, so they need no translation keys.
export const LANGUAGE_ENDONYMS: Record<SupportedLanguage, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  ja: '日本語',
  fr: 'Français',
  pt: 'Português',
  ru: 'Русский',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
};

export const LANGUAGE_STORAGE_KEY = '2anki-language';

// Every locale namespace file under ./locales/<lang>/<namespace>.json is loaded
// automatically. To add a surface's strings, drop a new <namespace>.json into
// each language folder and reference it with t('<namespace>:key') — no edit to
// this file is required, which lets parallel work add namespaces without
// colliding here.
const localeModules = import.meta.glob<{ default: Record<string, unknown> }>(
  './locales/*/*.json',
  { eager: true }
);

function buildResources(): Resource {
  const resources: Resource = {};
  for (const [path, mod] of Object.entries(localeModules)) {
    const match = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) {
      continue;
    }
    const [, language, namespace] = match;
    resources[language] ??= {};
    (resources[language] as Record<string, unknown>)[namespace] =
      mod.default ?? mod;
  }
  return resources;
}

export const i18nInitOptions: InitOptions = {
  resources: buildResources(),
  defaultNS: 'common',
  fallbackNS: 'common',
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LANGUAGES],
  nonExplicitSupportedLngs: true,
  load: 'languageOnly',
  returnEmptyString: true,
  detection: {
    order: ['localStorage', 'navigator'],
    lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    caches: ['localStorage'],
  },
  interpolation: {
    escapeValue: false,
  },
};

export function initI18n(instance: I18n = i18n) {
  if (instance.isInitialized) {
    return instance;
  }

  instance.use(LanguageDetector).use(initReactI18next).init(i18nInitOptions);
  setRouteDocumentLanguage(
    routeDocumentLanguage(
      globalThis.location?.pathname ?? '/',
      instance.resolvedLanguage ?? FALLBACK_LANGUAGE
    )
  );
  followAppLanguage(instance);

  return instance;
}

export default i18n;
