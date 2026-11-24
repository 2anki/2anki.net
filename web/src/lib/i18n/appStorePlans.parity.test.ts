import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('./locales/*/pricingtable.json', {
  eager: true,
}) as Record<string, { default: { faq: Record<string, { answer: string }> } }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const APP_STORE_PLANS = ['Day Pass', 'Week Pass', 'Semester Pass', 'Pro'];

describe('the App Store answer on the pricing page', () => {
  it.each(LANGS)('%s names every plan sold in the app', (lang) => {
    const answer =
      modules[`./locales/${lang}/pricingtable.json`].default.faq.q6.answer;
    for (const plan of APP_STORE_PLANS) {
      expect(answer).toContain(plan);
    }
  });
});
