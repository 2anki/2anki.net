import { describe, expect, it } from 'vitest';

import type { LandingCopy } from '../types';
import pdfCopy from './pdf';
import pdfZuAnkiCopy from './pdf-zu-anki';

function faqAnswer(copy: LandingCopy, question: string): string {
  const faq = copy.faqs.find((item) => item.q === question);
  expect(faq).toBeDefined();
  return faq?.a ?? '';
}

function everyClaim(copy: LandingCopy): string[] {
  return [
    copy.description,
    ...(copy.whatComesAcross ?? []).flatMap((item) => [item.title, item.body]),
    ...copy.faqs.map((faq) => faq.a),
  ];
}

describe('PDF landing copy describes the cards a PDF makes', () => {
  it.each([
    {
      copy: pdfCopy,
      question: 'How does it pick what becomes a card?',
      claim:
        'Each heading becomes a card front and the text under it becomes the back',
    },
    {
      copy: pdfZuAnkiCopy,
      question: 'Wie entscheidet 2anki, was zur Karte wird?',
      claim: 'Sie wird zur Kartenvorderseite, der Text darunter zur Rückseite',
    },
  ])(
    '$copy.pathname says a heading fronts its card',
    ({ copy, question, claim }) => {
      expect(faqAnswer(copy, question)).toContain(claim);
    }
  );

  it.each([
    { copy: pdfCopy, stale: /headings as decks|deck and tag names/i },
    {
      copy: pdfZuAnkiCopy,
      stale: /Überschriften werden zu Decks|Deck- und Tag-Namen/i,
    },
  ])(
    '$copy.pathname no longer says headings become decks',
    ({ copy, stale }) => {
      expect(everyClaim(copy).filter((text) => stale.test(text))).toEqual([]);
    }
  );
});
