import { describe, expect, it } from 'vitest';

import english from '../../lib/i18n/locales/en/pricingtable.json';
import { PRICING_FAQ } from './pricingFaq';

function englishText(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node != null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      english
    );
}

describe('pricing FAQ structured data', () => {
  const fixedAnswers = PRICING_FAQ.filter(
    (item) => item.answerValues === undefined
  );

  it.each(fixedAnswers.map((item) => [item.answerKey, item] as const))(
    'matches the visible English answer for %s',
    (_key, item) => {
      expect(item.answer).toBe(englishText(item.answerKey));
    }
  );

  it.each(PRICING_FAQ.map((item) => [item.questionKey, item] as const))(
    'matches the visible English question for %s',
    (_key, item) => {
      expect(item.question).toBe(englishText(item.questionKey));
    }
  );
});
