import type { i18n as I18n } from 'i18next';

const FALLBACK_LANGUAGE = 'en';

let appLanguage = FALLBACK_LANGUAGE;
let pinnedLanguage: string | null = null;

function applyDocumentLanguage() {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.lang = pinnedLanguage ?? appLanguage;
}

export function followAppLanguage(instance: I18n) {
  const update = () => {
    appLanguage = instance.resolvedLanguage ?? FALLBACK_LANGUAGE;
    applyDocumentLanguage();
  };
  instance.on('languageChanged', update);
  update();
}

export function pinDocumentLanguage(language: string): () => void {
  pinnedLanguage = language;
  applyDocumentLanguage();
  return () => {
    pinnedLanguage = null;
    applyDocumentLanguage();
  };
}
