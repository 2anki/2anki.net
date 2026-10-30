import { describe, expect, it } from 'vitest';

const modules = import.meta.glob('./locales/*/*.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const LANGS = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const PASS_BUTTONS: [namespace: string, key: string, pass: string][] = [
  ['common', 'pricing.pass.getDayPass', 'Day Pass'],
  ['common', 'pricing.pass.getWeekPass', 'Week Pass'],
  ['common', 'pricing.pass.getSemesterPass', 'Semester Pass'],
  ['common', 'upload.limit.getDayPass', 'Day Pass'],
  ['common', 'conversionResult.paywall.getDayPass', 'Day Pass'],
  ['common', 'conversionResult.paywall.getWeekPass', 'Week Pass'],
  ['search', 'limit.getDayPass', 'Day Pass'],
  ['anonymousPass', 'cta', 'Day Pass'],
  ['passFirst', 'day', 'Day Pass'],
  ['passFirst', 'semester', 'Semester Pass'],
  ['monthlyPartial', 'dayPass', 'Day Pass'],
  ['monthlyPartial', 'semesterPass', 'Semester Pass'],
];

const PENDING_LABELS: [namespace: string, key: string][] = [
  ['common', 'auth.register.creating'],
  ['common', 'auth.checkEmail.sending'],
  ['common', 'pricing.pass.startingCheckout'],
];

function read(lang: string, namespace: string, key: string): string {
  const file = modules[`./locales/${lang}/${namespace}.json`]?.default;
  let node: unknown = file;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`${lang}/${namespace}:${key} is missing`);
  }
  return node;
}

describe('paywall vocabulary in every locale', () => {
  it.each(LANGS)(
    'names the pass and ends with its live price on every pass button in %s',
    (lang) => {
      for (const [namespace, key, pass] of PASS_BUTTONS) {
        const label = read(lang, namespace, key);
        expect(label, `${namespace}:${key}`).toContain(pass);
        expect(label, `${namespace}:${key}`).toMatch(/ · \{\{price\}\}$/);
        if (lang !== 'en') {
          expect(label, `${namespace}:${key}`).not.toMatch(/^Get /);
        }
      }
    }
  );

  it.each(LANGS)('writes pending labels without an ellipsis in %s', (lang) => {
    for (const [namespace, key] of PENDING_LABELS) {
      expect(read(lang, namespace, key), `${namespace}:${key}`).not.toMatch(
        /…|\.\.\./
      );
    }
  });
});
