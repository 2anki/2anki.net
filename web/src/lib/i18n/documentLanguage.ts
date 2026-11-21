import type { i18n as I18n } from 'i18next';

export const FALLBACK_LANGUAGE = 'en';

interface Pin {
  language: string;
}

let appLanguage = FALLBACK_LANGUAGE;
let routeLanguage: string | null = null;
const pins: Pin[] = [];
let writtenLanguage: string | null = null;

function applyDocumentLanguage() {
  if (typeof document === 'undefined') {
    return;
  }
  const language = pins.at(-1)?.language ?? routeLanguage ?? appLanguage;
  document.documentElement.lang = language;
  writtenLanguage = language;
}

export function followAppLanguage(instance: I18n) {
  const update = () => {
    appLanguage = instance.resolvedLanguage ?? FALLBACK_LANGUAGE;
    applyDocumentLanguage();
  };
  instance.on('languageChanged', update);
  update();
}

export function setRouteDocumentLanguage(language: string | null) {
  routeLanguage = language;
  applyDocumentLanguage();
}

export function pinDocumentLanguage(language: string): () => void {
  const pin: Pin = { language };
  pins.push(pin);
  applyDocumentLanguage();
  return () => {
    const index = pins.indexOf(pin);
    if (index !== -1) {
      pins.splice(index, 1);
    }
    applyDocumentLanguage();
  };
}

export function documentLanguageWeSet(): string | null {
  return writtenLanguage;
}
