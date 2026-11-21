import { useTranslation } from 'react-i18next';
import { FALLBACK_LANGUAGE } from './documentLanguage';

export function useAppLanguage(): string {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage ?? FALLBACK_LANGUAGE;
}
