import { describe, expect, it } from 'vitest';

import { ANSWERS_PAGES, type AnswerConfig } from './answersConfig';

function page(slug: string): AnswerConfig {
  const config = ANSWERS_PAGES.get(slug);
  expect(config).toBeDefined();
  return config as AnswerConfig;
}

function everyClaim(config: AnswerConfig): string[] {
  return [
    config.description,
    config.intro,
    ...config.sections.map((section) => section.body),
    ...(config.faqs ?? []).map((faq) => faq.a),
  ];
}

function sectionBody(config: AnswerConfig, heading: string): string {
  const section = config.sections.find((s) => s.heading === heading);
  expect(section).toBeDefined();
  return section?.body ?? '';
}

function faqAnswer(config: AnswerConfig, question: string): string {
  const faq = (config.faqs ?? []).find((item) => item.q === question);
  expect(faq).toBeDefined();
  return faq?.a ?? '';
}

const UPLOAD_GUIDES = [
  'pdf-to-anki',
  'word-to-anki',
  'google-docs-to-anki',
  'lecture-notes-to-anki',
  'textbook-to-anki',
];

describe('answers guides describe the cards a PDF or Word upload makes', () => {
  it.each(UPLOAD_GUIDES)(
    '%s no longer says headings make decks or subdecks',
    (slug) => {
      expect(
        everyClaim(page(slug)).filter((text) =>
          /subdeck|name the deck|naming the deck|headings to name decks|headings for deck/i.test(
            text
          )
        )
      ).toEqual([]);
    }
  );

  it.each(UPLOAD_GUIDES)(
    '%s no longer says strikethrough tags every card in the deck',
    (slug) => {
      expect(
        everyClaim(page(slug)).filter((text) =>
          /tag (applied to|on) every card/i.test(text)
        )
      ).toEqual([]);
    }
  );

  it('pdf-to-anki says a heading fronts its card and a text slide title fronts its slide', () => {
    const config = page('pdf-to-anki');
    const body = sectionBody(config, 'How cards are built');
    expect(body).toContain(
      'Each heading becomes a card front, and the text under it, up to the next heading, becomes the back.'
    );
    expect(body).toContain(
      'In a text slide PDF, where every page is landscape, each slide becomes one card, with the slide title on the front and its bullets on the back.'
    );
    expect(config.description).toContain(
      'In a text slide PDF, each slide becomes one card.'
    );
  });

  it.each(['pdf-to-anki', 'textbook-to-anki'])(
    '%s says a Word-outline PDF fronts each top-level bullet instead of keeping every bullet on the back',
    (slug) => {
      const body = sectionBody(page(slug), 'How cards are built');
      expect(body).toContain(
        'A bullet with a space after its marker stays on the back; in a PDF exported from a Word outline, each top-level bullet fronts its own card.'
      );
      expect(body).not.toMatch(/Bullets stay on the back of the heading/i);
    }
  );

  it.each(['word-to-anki', 'google-docs-to-anki'])(
    '%s says a list or 4 or more short paragraphs under a heading become one card per item',
    (slug) => {
      const claims = everyClaim(page(slug)).join('\n');
      expect(claims).toContain(
        'Each heading becomes a card front, and the text under it becomes the back. A list under a heading, or 4 or more short paragraphs, becomes one card per item instead'
      );
      expect(claims).not.toContain(
        'Each bullet under a heading becomes its own card'
      );
    }
  );

  it('word-to-anki answers how 2anki decides what becomes a card', () => {
    expect(
      faqAnswer(
        page('word-to-anki'),
        'How does 2anki decide what becomes a card?'
      )
    ).toContain(
      'A list under a heading, or 4 or more short paragraphs, becomes one card per item instead.'
    );
  });

  it.each(['word-to-anki', 'google-docs-to-anki'])(
    '%s limits one card per table row to a document with no headings',
    (slug) => {
      const claims = everyClaim(page(slug));
      const tableClaims = claims.filter((text) =>
        /one card per row|each row becoming a card/i.test(text)
      );
      expect(tableClaims).toHaveLength(2);
      for (const text of tableClaims) {
        expect(text).toMatch(/in a document with no headings/i);
      }
      expect(
        claims.filter((text) =>
          /no heading sits above|no headings above it/i.test(text)
        )
      ).toEqual([]);
    }
  );
});
