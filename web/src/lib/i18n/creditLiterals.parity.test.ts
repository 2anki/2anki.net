import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRICING_FAQ } from '../../pages/PricingPage/pricingFaq';
import commonEn from './locales/en/common.json';
import pricingtableEn from './locales/en/pricingtable.json';

function readAllowanceSource(): string {
  return readFileSync(
    join(__dirname, '../../../../src/lib/claude/aiCredits/allowance.ts'),
    'utf8'
  );
}

function readNumber(source: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

const allowance = readAllowanceSource();
const dayPass = readNumber(allowance, /'24h':\s*(\d+)/);
const weekPass = readNumber(allowance, /'7d':\s*(\d+)/);
const semesterPass = readNumber(allowance, /'120d':\s*(\d+)/);
const subscription = readNumber(
  allowance,
  /export const SUBSCRIPTION_CREDITS\s*=\s*(\d+)/
);

function faqAnswer(question: string): string {
  const item = PRICING_FAQ.find((entry) => entry.question === question);
  expect(item).toBeDefined();
  return item?.answer ?? '';
}

describe('AI credit literals in English copy match the server allowance', () => {
  it('the pass FAQ in structured data names the credits each pass includes', () => {
    const answer = faqAnswer('Is there a one-time payment option?');
    expect(answer).toContain(`includes ${dayPass} AI credits`);
    expect(answer).toContain(`with ${weekPass} credits`);
    expect(answer).toContain(`with ${semesterPass} credits`);
  });

  it('the visible pass FAQ names the same credits', () => {
    const answer = pricingtableEn.faq.q2.answer;
    expect(answer).toContain(`includes ${dayPass} AI credits`);
    expect(answer).toContain(`with ${weekPass} credits`);
    expect(answer).toContain(`with ${semesterPass} credits`);
  });

  it('the Pro FAQ, in structured data and on the page, names the monthly credits', () => {
    const monthly = `${subscription} credits a month`;
    expect(faqAnswer('What is the Pro plan?')).toContain(monthly);
    expect(pricingtableEn.faq.q3.answer).toContain(monthly);
  });

  it('the comparison table cells show the pass and monthly credits', () => {
    expect(pricingtableEn.cells.creditsPass).toBe(`${dayPass} / ${weekPass}`);
    expect(pricingtableEn.cells.creditsMonth).toBe(`${subscription} / mo`);
  });

  it('the Pro card benefit names the monthly credits', () => {
    expect(commonEn.pricing.unlimited.benefitAi).toContain(
      `${subscription} AI credits a month`
    );
  });
});
