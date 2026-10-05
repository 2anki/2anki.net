import i18n, {
  type BackendModule,
  type InitOptions,
  type ReadCallback,
  type Resource,
  type ResourceLanguage,
} from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const LANGUAGE_STORAGE_KEY = '2anki-language';

const englishModules = import.meta.glob<{ default: ResourceLanguage }>(
  './locales/en/*.json',
  { eager: true }
);

const lazyModules = import.meta.glob<{ default: ResourceLanguage }>(
  './locales/*/*.json'
);

function namespaceFromPath(filePath: string): string | null {
  return /\/([^/]+)\.json$/.exec(filePath)?.[1] ?? null;
}

function languageFromPath(filePath: string): string | null {
  return /\/locales\/([^/]+)\//.exec(filePath)?.[1] ?? null;
}

function buildEnglishResources(): {
  resources: Resource;
  namespaces: string[];
} {
  const english: ResourceLanguage = {};
  for (const [filePath, mod] of Object.entries(englishModules)) {
    const namespace = namespaceFromPath(filePath);
    if (namespace) {
      english[namespace] = mod.default;
    }
  }
  return { resources: { en: english }, namespaces: Object.keys(english) };
}

function supportedLanguagesFromGlob(): string[] {
  const languages = new Set<string>();
  for (const filePath of Object.keys(lazyModules)) {
    const language = languageFromPath(filePath);
    if (language) {
      languages.add(language);
    }
  }
  return [...languages];
}

const lazyLocaleBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language: string, namespace: string, callback: ReadCallback) {
    const loader = lazyModules[`./locales/${language}/${namespace}.json`];
    if (!loader) {
      callback(null, {});
      return;
    }
    loader()
      .then((mod) => callback(null, mod.default))
      .catch((error: Error) => callback(error, null));
  },
};

export function initTestI18n() {
  if (i18n.isInitialized) {
    return i18n;
  }

  const { resources, namespaces } = buildEnglishResources();

  const options: InitOptions = {
    resources,
    ns: namespaces,
    defaultNS: 'common',
    fallbackNS: 'common',
    fallbackLng: 'en',
    supportedLngs: supportedLanguagesFromGlob(),
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    partialBundledLanguages: true,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  };

  i18n
    .use(lazyLocaleBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init(options);

  return i18n;
}
