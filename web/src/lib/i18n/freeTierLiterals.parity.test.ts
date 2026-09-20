import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRICING_FAQ } from '../../pages/PricingPage/pricingFaq';
import deTable from './locales/de/pricingtable.json';
import enTable from './locales/en/pricingtable.json';
import esTable from './locales/es/pricingtable.json';
import frTable from './locales/fr/pricingtable.json';
import itTable from './locales/it/pricingtable.json';
import jaTable from './locales/ja/pricingtable.json';
import nlTable from './locales/nl/pricingtable.json';
import plTable from './locales/pl/pricingtable.json';
import ptTable from './locales/pt/pricingtable.json';
import ruTable from './locales/ru/pricingtable.json';

const LOCALES = {
  en: enTable,
  de: deTable,
  es: esTable,
  fr: frTable,
  it: itTable,
  ja: jaTable,
  nl: nlTable,
  pl: plTable,
  pt: ptTable,
  ru: ruTable,
};

function readLimitsSource(): string {
  return readFileSync(
    join(
      __dirname,
      '../../../../src/usecases/users/CheckMonthlyCardLimitUseCase.ts'
    ),
    'utf8'
  );
}

function readNumber(source: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

const limits = readLimitsSource();
const anonymousCap = readNumber(
  limits,
  /export const ANONYMOUS_CARD_CAP\s*=\s*(\d+)/
);
const monthlyLimit = readNumber(
  limits,
  /export const MONTHLY_CARD_LIMIT\s*=\s*(\d+)/
);

const FREE_CARDS_QUESTION = 'How many cards can I make for free?';

function structuredDataAnswer(): string {
  const item = PRICING_FAQ.find(
    (entry) => entry.question === FREE_CARDS_QUESTION
  );
  expect(item).toBeDefined();
  return item?.answer ?? '';
}

describe('free-tier literals in the pricing FAQ match the server limits', () => {
  it('the structured data answer states the anonymous cap and the monthly limit', () => {
    const answer = structuredDataAnswer();
    expect(answer).toContain(`capped at ${anonymousCap} cards`);
    expect(answer).toContain(`${monthlyLimit} cards per month`);
  });

  it('the visible English answer is the same text as the structured data', () => {
    expect(enTable.faq.q1.answer).toBe(structuredDataAnswer());
  });

  it.each(Object.entries(LOCALES))(
    '%s answer names the anonymous cap and keeps the protected monthly string',
    (_locale, table) => {
      const answer = table.faq.q1.answer;
      expect(answer).toMatch(new RegExp(`(^|\\D)${anonymousCap}(\\D|$)`));
      expect(answer).toContain(`${monthlyLimit} cards per month`);
    }
  );
});
