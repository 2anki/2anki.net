import type { LandingFaq } from './types';

export function buildFaqJsonLd(faqs: ReadonlyArray<LandingFaq>): string | null {
  if (faqs.length === 0) {
    return null;
  }
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  });
}
