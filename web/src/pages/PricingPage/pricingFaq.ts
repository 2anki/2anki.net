import { FALLBACK_PASS_PRICES } from './payment.links';
import type { PassPriceDisplay } from '../../lib/hooks/usePassPrices';

export interface PricingFaqItem {
  question: string;
  answer: string;
  questionKey: string;
  answerKey: string;
  answerValues?: Record<string, string>;
}

export const buildPricingFaq = (
  passPrices: PassPriceDisplay
): PricingFaqItem[] => [
  {
    question: 'How many cards can I make for free?',
    answer:
      '100 cards per month on the free plan. No account required for one-off conversions — drop a file and download a deck.',
    questionKey: 'faq.q1.question',
    answerKey: 'faq.q1.answer',
  },
  {
    question: 'Is there a one-time payment option?',
    answer: `Day Pass (${passPrices['24h']}) gives 24 hours of unlimited access. Week Pass (${passPrices['7d']}) gives 7 days. Semester Pass (${passPrices['120d']}) gives about 4 months. All are one-time payments, no subscription required.`,
    questionKey: 'faq.q2.question',
    answerKey: 'faq.q2.answer',
    answerValues: {
      dayPrice: passPrices['24h'],
      weekPrice: passPrices['7d'],
      semesterPrice: passPrices['120d'],
    },
  },
  {
    question: 'What is the Unlimited plan?',
    answer:
      'Unlimited removes the 100-card limit, adds PDF support, lets you run multiple conversions at once, and includes Anki to Notion imports of up to 10,000 notes each. Pricing is on the cards above.',
    questionKey: 'faq.q3.question',
    answerKey: 'faq.q3.answer',
  },
  {
    question: 'Is there a lifetime plan?',
    answer:
      'Not anymore. Lifetime is closed to new members. If you already have Lifetime, your access and every feature stay exactly as they are. For unlimited access, use the Unlimited plan on the cards above.',
    questionKey: 'faq.q4.question',
    answerKey: 'faq.q4.answer',
  },
  {
    question: 'Can I cancel anytime?',
    answer:
      'Cancel in one click from your account — no need to email support. On a yearly plan, cancelling stops the next renewal and your access stays through the year you already paid for; unused time is not refunded. Passes are one-time, so there is nothing to cancel.',
    questionKey: 'faq.q5.question',
    answerKey: 'faq.q5.answer',
  },
  {
    question: 'Is there an app?',
    answer:
      'Yes — 2anki is free on the App Store for iPhone, iPad, and Mac, alongside the web app. Files are parsed on-device. The same plans apply: Day Pass, Week Pass, and Unlimited are available as in-app purchases.',
    questionKey: 'faq.q6.question',
    answerKey: 'faq.q6.answer',
  },
  {
    question: 'What happens to my decks if I stop paying?',
    answer:
      'They stay yours. Every deck exports as a native .apkg that works in any Anki client, offline, with no lock-in.',
    questionKey: 'faq.q7.question',
    answerKey: 'faq.q7.answer',
  },
];

export const PRICING_FAQ: PricingFaqItem[] =
  buildPricingFaq(FALLBACK_PASS_PRICES);
