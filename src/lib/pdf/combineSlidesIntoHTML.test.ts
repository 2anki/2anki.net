import { vi } from 'vitest';
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
    chromeParagraphs: [],
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
    expect(card.back).toContain('<hr /><p>Remember PMAT</p>');
    expect(card.back.indexOf('<ul>')).toBeLessThan(card.back.indexOf('<img'));
    expect(card.back.indexOf('<img')).toBeLessThan(card.back.indexOf('<hr />'));
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

  it('skips a numbered text box and fronts the first line with words when a slide has no title', () => {
    const html = combineSlidesIntoHTML(
      [
        slide({
          paragraphs: ['03', 'Endocytosis', 'Phagocytosis: cell eating'],
        }),
      ],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('Endocytosis');
    expect(card.back).toBe(
      '<ul><li>03</li><li>Phagocytosis: cell eating</li></ul><img src="pdf-x/slide-1.png" />'
    );
  });

  it('keeps the first paragraph as the front when no line on an untitled slide has a letter', () => {
    const html = combineSlidesIntoHTML(
      [slide({ paragraphs: ['2024', '1.5'] })],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('2024');
    expect(card.back).toBe(
      '<ul><li>1.5</li></ul><img src="pdf-x/slide-1.png" />'
    );
  });

  it('keeps the title on the front of a titled slide whose first paragraph is a number', () => {
    const html = combineSlidesIntoHTML(
      [slide({ title: 'Mitosis', paragraphs: ['03', 'Prophase'] })],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('Mitosis');
    expect(card.back).toBe(
      '<ul><li>03</li><li>Prophase</li></ul><img src="pdf-x/slide-1.png" />'
    );
  });

  it.each(['細胞分裂', 'Митоз', 'Μίτωση', 'الانقسام'])(
    'counts %s as a line with words',
    (heading) => {
      const html = combineSlidesIntoHTML(
        [slide({ paragraphs: ['12', heading] })],
        [],
        'lecture.pdf',
        WORKSPACE
      );

      expect(cards(html)[0].front).toBe(heading);
    }
  );

  it('does not read the name of an escaped symbol as words', () => {
    const html = combineSlidesIntoHTML(
      [slide({ paragraphs: ['&lt; 0.05', 'Significant result'] })],
      [],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('Significant result');
    expect(card.back).toBe('<ul><li>&lt; 0.05</li></ul>');
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

  it('answers a picture slide whose only text is its slide number and footer with that text', () => {
    const html = combineSlidesIntoHTML(
      [
        slide({
          role: 'image',
          hasPicture: true,
          chromeParagraphs: ['Cell Biology', '2'],
        }),
      ],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('<img src="pdf-x/slide-1.png" />');
    expect(card.back).toBe('<ul><li>Cell Biology</li><li>2</li></ul>');
  });

  it('answers a picture slide with its speaker notes, not its slide number, when it has notes', () => {
    const html = combineSlidesIntoHTML(
      [
        slide({
          role: 'image',
          hasPicture: true,
          speakerNotes: 'Label the four phases',
          chromeParagraphs: ['3'],
        }),
      ],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('<img src="pdf-x/slide-1.png" />');
    expect(card.back).toBe('<hr /><p>Label the four phases</p>');
  });

  it('leaves the slide number and footer off a card that already has an answer', () => {
    const html = combineSlidesIntoHTML(
      [
        slide({
          title: 'Mitosis',
          paragraphs: ['Prophase'],
          chromeParagraphs: ['Cell Biology', '1'],
        }),
      ],
      [IMAGES[0]],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('Mitosis');
    expect(card.back).toBe(
      '<ul><li>Prophase</li></ul><img src="pdf-x/slide-1.png" />'
    );
  });

  it('answers a title-only slide with its footer when there is no slide image', () => {
    const html = combineSlidesIntoHTML(
      [slide({ title: 'Part 2', chromeParagraphs: ['Cell Biology', '5'] })],
      [],
      'lecture.pdf',
      WORKSPACE
    );

    const [card] = cards(html);
    expect(card.front).toBe('Part 2');
    expect(card.back).toBe('<ul><li>Cell Biology</li><li>5</li></ul>');
  });

  it('never fronts a card with a slide number: a slide with only chrome and no slide image is skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const html = combineSlidesIntoHTML(
        [slide({ id: 'slide-4', chromeParagraphs: ['Cell Biology', '4'] })],
        [],
        'lecture.pdf',
        WORKSPACE
      );

      expect(cards(html)).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        '[combineSlidesIntoHTML] slide has nothing to show',
        { slide: 'slide-4' }
      );
    } finally {
      warn.mockRestore();
    }
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

  it('warns and skips a slide with no text and no page image instead of emitting an empty card', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const html = combineSlidesIntoHTML(
        [slide({ id: 'slide-7', role: 'image', hasPicture: true })],
        [],
        'lecture.pdf',
        WORKSPACE
      );

      expect(cards(html)).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        '[combineSlidesIntoHTML] slide has nothing to show',
        { slide: 'slide-7' }
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('escapes the document title so a filename cannot break out of the head', () => {
    const html = combineSlidesIntoHTML(
      [slide({ title: 'One' })],
      [],
      '</title><script>x</script>.pdf',
      WORKSPACE
    );

    expect(html).toContain(
      '<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;.pdf</title>'
    );
    expect(html).not.toContain('<script>');
  });
});
