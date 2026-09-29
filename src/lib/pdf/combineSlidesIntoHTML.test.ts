import { combineSlidesIntoHTML } from './combineSlidesIntoHTML';
import type { SlideUnit } from '../parser/sourceUnits/extractPptxSourceUnits';

function slide(overrides: Partial<SlideUnit> = {}): SlideUnit {
  return {
    id: 'slide-1',
    visibleText: '',
    speakerNotes: '',
    role: 'body',
    title: '',
    paragraphs: [],
    hasPicture: false,
    ...overrides,
  };
}

const WORKSPACE = '/tmp/ws';
const IMAGES = [
  `${WORKSPACE}/pdf-x/slide-1.png`,
  `${WORKSPACE}/pdf-x/slide-2.png`,
];

function cards(html: string): { front: string; back: string }[] {
  const pattern = /<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  const found: { front: string; back: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    found.push({ front: match[1].trim(), back: match[2].trim() });
  }
  return found;
}

describe('combineSlidesIntoHTML', () => {
  it('makes one card per slide: title on the front, bullets, image and notes on the back', () => {
    const html = combineSlidesIntoHTML(
      [
        slide({
          title: 'Mitosis',
          paragraphs: ['Prophase', 'Metaphase'],
          speakerNotes: 'Remember PMAT',
        }),
      ],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(cards(html)).toHaveLength(1);
    expect(card.front).toBe('Mitosis');
    expect(card.back).toContain('<ul><li>Prophase</li><li>Metaphase</li></ul>');
    expect(card.back).toContain('<img src="pdf-x/slide-1.png" />');
    expect(card.back).toContain('Speaker notes');
    expect(card.back).toContain('<p>Remember PMAT</p>');
    expect(card.back.indexOf('<ul>')).toBeLessThan(card.back.indexOf('<img'));
    expect(card.back.indexOf('<img')).toBeLessThan(
      card.back.indexOf('Speaker notes')
    );
  });

  it('keeps a title-only slide as a card with the slide image on the back', () => {
    const html = combineSlidesIntoHTML(
      [slide({ title: 'Part 2' })],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('Part 2');
    expect(card.back).toBe('<img src="pdf-x/slide-1.png" />');
  });

  it('uses the first paragraph as the front when a slide has no title', () => {
    const html = combineSlidesIntoHTML(
      [slide({ paragraphs: ['What is ATP?', 'Energy currency'] })],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('What is ATP?');
    expect(card.back).toContain('<ul><li>Energy currency</li></ul>');
  });

  it('puts the slide image on the front of an image-only slide and never repeats it on the back', () => {
    const html = combineSlidesIntoHTML(
      [slide({ role: 'image', hasPicture: true, speakerNotes: 'A diagram' })],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('<img src="pdf-x/slide-1.png" />');
    expect(card.back).not.toContain('<img');
    expect(card.back).toContain('<p>A diagram</p>');
  });

  it('never pairs one slide with the next: two slides give two cards', () => {
    const html = combineSlidesIntoHTML(
      [
        slide({ id: 'slide-1', title: 'One', paragraphs: ['a'] }),
        slide({ id: 'slide-2', title: 'Two', paragraphs: ['b'] }),
      ],
      IMAGES,
      'lecture.pdf',
      WORKSPACE
    );

    expect(cards(html).map((c) => c.front)).toEqual(['One', 'Two']);
    expect(html).toContain('pdf-x/slide-2.png');
  });

  it('leaves the image out when the page render is missing for that slide', () => {
    const html = combineSlidesIntoHTML(
      [slide({ title: 'One', paragraphs: ['a'] })],
      [],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.back).toBe('<ul><li>a</li></ul>');
  });

  it('splits multi-line speaker notes into paragraphs', () => {
    const html = combineSlidesIntoHTML(
      [slide({ title: 'One', speakerNotes: 'line one\nline two' })],
      [],
      'lecture.pdf',
      WORKSPACE
    );

    expect(cards(html)[0].back).toContain('<p>line one</p><p>line two</p>');
  });
});
