import { hasOnlySlideSource, SLIDE_SOURCE_CLASS } from './slideSource';

const source = `<p class="${SLIDE_SOURCE_CLASS}">Cell Biology · 2</p>`;

describe('hasOnlySlideSource', () => {
  it.each([
    ['a back that is only the source line', source],
    [
      'a back with the slide image and the source line',
      `<img src="slide-1.png" />${source}`,
    ],
  ])('finds no answer of its own in %s', (_label, back) => {
    expect(hasOnlySlideSource(back)).toBe(true);
  });

  it.each([
    ['a back with text of its own', '<ul><li>Prophase</li></ul>'],
    ['a short paragraph', '<p>Cell Biology · 2</p>'],
    ['text beside the source line', `<p>Label the phases</p>${source}`],
  ])('finds an answer of its own in %s', (_label, back) => {
    expect(hasOnlySlideSource(back)).toBe(false);
  });
});
