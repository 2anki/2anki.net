import { hasOnlySlideSource, SLIDE_SOURCE_ATTRIBUTE } from './slideSource';

const source = `<p ${SLIDE_SOURCE_ATTRIBUTE}>Cell Biology · 2</p>`;

describe('hasOnlySlideSource', () => {
  it.each([
    ['a back that is only the source line', source],
    [
      'a back with the slide image and the source line',
      `<img src="slide-1.png" />${source}`,
    ],
    [
      'a back whose source line the parser wrote out again',
      '<p data-2anki-slide-source="">Cell Biology · 2</p>',
    ],
  ])('finds no answer of its own in %s', (_label, back) => {
    expect(hasOnlySlideSource(back)).toBe(true);
  });

  it.each([
    ['a back with text of its own', '<ul><li>Prophase</li></ul>'],
    ['a short paragraph', '<p>Cell Biology · 2</p>'],
    ['text beside the source line', `<p>Label the phases</p>${source}`],
    [
      'a paragraph with a class named slide-source',
      '<p class="slide-source">Cell Biology · 2</p>',
    ],
  ])('finds an answer of its own in %s', (_label, back) => {
    expect(hasOnlySlideSource(back)).toBe(false);
  });
});
