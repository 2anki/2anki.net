import { describe, expect, it } from 'vitest';

import enAccount from '../en/account.json';
import enAnkify from '../en/ankify.json';
import enChat from '../en/chat.json';
import enCommon from '../en/common.json';
import enErrors from '../en/errors.json';
import enLanding from '../en/landing.json';
import enMarketing from '../en/marketing.json';
import enSearch from '../en/search.json';
import enTools from '../en/tools.json';
import nlAccount from './account.json';
import nlAnkify from './ankify.json';
import nlChat from './chat.json';
import nlCommon from './common.json';
import nlErrors from './errors.json';
import nlLanding from './landing.json';
import nlMarketing from './marketing.json';
import nlSearch from './search.json';
import nlTools from './tools.json';

type JsonValue = string | { [key: string]: JsonValue };
type Namespace = Record<string, JsonValue>;

const PAIRS: Array<[string, Namespace, Namespace]> = [
  ['account', enAccount, nlAccount],
  ['ankify', enAnkify, nlAnkify],
  ['chat', enChat, nlChat],
  ['common', enCommon, nlCommon],
  ['errors', enErrors, nlErrors],
  ['landing', enLanding, nlLanding],
  ['marketing', enMarketing, nlMarketing],
  ['search', enSearch, nlSearch],
  ['tools', enTools, nlTools],
];

function flatten(
  value: JsonValue,
  prefix = '',
  out: Record<string, string> = {}
): Record<string, string> {
  if (typeof value === 'string') {
    out[prefix] = value;
    return out;
  }
  for (const key of Object.keys(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    flatten(value[key], next, out);
  }
  return out;
}

function placeholders(text: string): string[] {
  return (text.match(/{{.*?}}/g) ?? []).sort();
}

describe('Dutch (nl) locale parity', () => {
  it.each(PAIRS)('%s has exactly the same keys as English', (_name, en, nl) => {
    expect(Object.keys(flatten(nl)).sort()).toEqual(
      Object.keys(flatten(en)).sort()
    );
  });

  it.each(PAIRS)(
    '%s keeps every interpolation placeholder intact',
    (_name, en, nl) => {
      const flatEn = flatten(en);
      const flatNl = flatten(nl);
      for (const key of Object.keys(flatEn)) {
        expect(placeholders(flatNl[key])).toEqual(placeholders(flatEn[key]));
      }
    }
  );

  it('translates the overwhelming majority of values away from English', () => {
    let total = 0;
    let translated = 0;
    for (const [, en, nl] of PAIRS) {
      const flatEn = flatten(en);
      const flatNl = flatten(nl);
      for (const key of Object.keys(flatEn)) {
        total += 1;
        if (flatEn[key] !== flatNl[key]) {
          translated += 1;
        }
      }
    }
    expect(translated / total).toBeGreaterThan(0.9);
  });

  it('keeps Stripe plan nouns verbatim while translating the CTA verb', () => {
    const common = flatten(nlCommon);
    expect(common['pricing.pass.getDayPass']).toBe('Day Pass kopen');
    expect(common['pricing.pass.getWeekPass']).toBe('Week Pass kopen');
    expect(common['pricing.unlimited.getUnlimitedYearly']).toBe(
      'Pro kopen — jaarlijkse facturering'
    );
    expect(common['pricing.contextBanner']).toContain('100 kaarten per maand');
  });
});
