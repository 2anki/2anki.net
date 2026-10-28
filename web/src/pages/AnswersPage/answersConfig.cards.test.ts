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

  it('pdf-to-anki says a heading fronts its card and a slide title fronts its slide', () => {
    const body = sectionBody(page('pdf-to-anki'), 'How cards are built');
    expect(body).toContain(
      'Each heading becomes a card front, and the text under it, up to the next heading, becomes the back.'
    );
    expect(body).toContain(
      'the slide title on the front and its bullets on the back'
    );
  });

  it('pdf-to-anki no longer says bullets become card fronts', () => {
    expect(
      everyClaim(page('pdf-to-anki')).filter((text) =>
        /bullets become card fronts/i.test(text)
      )
    ).toEqual([]);
  });

  it.each(['word-to-anki', 'google-docs-to-anki'])(
    '%s says a heading fronts its card and each bullet under it becomes its own card',
    (slug) => {
      const claims = everyClaim(page(slug)).join('\n');
      expect(claims).toContain(
        'Each heading becomes a card front, and the text under it becomes the back.'
      );
      expect(claims).toContain(
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
    ).toContain('Each heading becomes a card front');
  });
});
