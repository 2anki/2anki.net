import { vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  combineSlidesIntoHTML,
  combineSlidesWithChromeIntoHTML,
} from '../../pdf/combineSlidesIntoHTML';
import {
  extractPptxSourceUnits,
  MAX_PPTX_PART_BYTES,
  PptxTooLargeError,
} from './extractPptxSourceUnits';

function buildPptx(slides: Array<{ xml: string; notesXml?: string }>): Buffer {
  const files: Record<string, Uint8Array> = {};

  slides.forEach((slide, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = strToU8(slide.xml);
    if (slide.notesXml) {
      files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(slide.notesXml);
    }
  });

  return Buffer.from(zipSync(files));
}

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

function slideXml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS_A}" xmlns:p="${NS_P}">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>${title}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>${body}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function notesXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="${NS_A}" xmlns:p="${NS_P}">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>${text}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
}

function imageSlidXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS_A}" xmlns:p="${NS_P}">
  <p:cSld>
    <p:spTree>
      <p:pic><p:nvPicPr><p:cNvPr name="image"/></p:nvPicPr></p:pic>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

describe('extractPptxSourceUnits', () => {
  it('returns one unit per slide with title and body text', () => {
    const pptx = buildPptx([{ xml: slideXml('Slide One', 'Body text here') }]);

    const units = extractPptxSourceUnits(pptx);

    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: 'slide-1',
      role: 'title',
      visibleText: 'Slide One\nBody text here',
      speakerNotes: '',
    });
  });

  it('assigns stable sequential IDs slide-1, slide-2, slide-3', () => {
    const pptx = buildPptx([
      { xml: slideXml('A', 'a') },
      { xml: slideXml('B', 'b') },
      { xml: slideXml('C', 'c') },
    ]);

    const units = extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.id)).toEqual(['slide-1', 'slide-2', 'slide-3']);
  });

  it('attaches speaker notes to the corresponding slide unit', () => {
    const pptx = buildPptx([
      {
        xml: slideXml('Mitosis', 'Cell division'),
        notesXml: notesXml(
          'Remember: prophase, metaphase, anaphase, telophase'
        ),
      },
    ]);

    const units = extractPptxSourceUnits(pptx);

    expect(units[0].speakerNotes).toBe(
      'Remember: prophase, metaphase, anaphase, telophase'
    );
  });

  it('returns empty array for a PPTX with no slides', () => {
    const pptx = Buffer.from(
      zipSync({ 'ppt/presentation.xml': strToU8('<root/>') })
    );

    const units = extractPptxSourceUnits(pptx);

    expect(units).toEqual([]);
  });

  it('assigns role image for slides with no text shapes', () => {
    const pptx = buildPptx([{ xml: imageSlidXml() }]);

    const units = extractPptxSourceUnits(pptx);

    expect(units[0]).toMatchObject({
      id: 'slide-1',
      role: 'image',
      visibleText: '',
      speakerNotes: '',
    });
  });

  it('handles multiple text runs within a paragraph', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS_A}" xmlns:p="${NS_P}">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>World</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
    const pptx = buildPptx([{ xml }]);

    const units = extractPptxSourceUnits(pptx);

    expect(units[0].visibleText).toBe('Hello World');
  });
});

function bodyOnlySlideXml(paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS_A}" xmlns:p="${NS_P}">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          ${paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('')}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function hiddenSlideXml(title: string): string {
  return slideXml(title, 'hidden body').replace('<p:sld ', '<p:sld show="0" ');
}

function withPresentationOrder(
  pptx: Buffer,
  slideNumbersInDisplayOrder: number[]
): Buffer {
  const files = unzipSync(new Uint8Array(pptx));
  const ids = slideNumbersInDisplayOrder.map(
    (n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`
  );
  files['ppt/presentation.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="${NS_P}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${ids.join('')}</p:sldIdLst>
</p:presentation>`
  );
  const rels = slideNumbersInDisplayOrder.map(
    (n) =>
      `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`
  );
  files['ppt/_rels/presentation.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
  );
  return Buffer.from(zipSync(files));
}

describe('extractPptxSourceUnits — slide structure for text-first cards', () => {
  it('keeps the title apart from the body paragraphs', () => {
    const pptx = buildPptx([{ xml: slideXml('Mitosis', 'Cell division') }]);

    const [unit] = extractPptxSourceUnits(pptx);

    expect(unit.title).toBe('Mitosis');
    expect(unit.paragraphs).toEqual(['Cell division']);
  });

  it('keeps each bullet as its own paragraph', () => {
    const pptx = buildPptx([
      { xml: bodyOnlySlideXml(['Prophase', 'Metaphase', 'Anaphase']) },
    ]);

    const [unit] = extractPptxSourceUnits(pptx);

    expect(unit.title).toBe('');
    expect(unit.paragraphs).toEqual(['Prophase', 'Metaphase', 'Anaphase']);
  });

  it('treats a centred title placeholder as the title', () => {
    const xml = slideXml('Welcome', 'Agenda').replace(
      'type="title"',
      'type="ctrTitle"'
    );

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.title).toBe('Welcome');
  });

  it('drops hidden slides so units line up with the exported PDF pages', () => {
    const pptx = buildPptx([
      { xml: slideXml('One', 'a') },
      { xml: hiddenSlideXml('Hidden') },
      { xml: slideXml('Three', 'c') },
    ]);

    const units = extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual(['One', 'Three']);
  });

  it('also drops slides hidden with show="false"', () => {
    const pptx = buildPptx([
      { xml: slideXml('One', 'a') },
      {
        xml: slideXml('Hidden', 'b').replace('<p:sld ', '<p:sld show="false" '),
      },
    ]);

    const units = extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual(['One']);
  });

  it('follows the presentation display order, not the slide file numbers', () => {
    const pptx = withPresentationOrder(
      buildPptx([
        { xml: slideXml('First file', 'a') },
        { xml: slideXml('Second file', 'b') },
        { xml: slideXml('Third file', 'c') },
      ]),
      [3, 1, 2]
    );

    const units = extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual([
      'Third file',
      'First file',
      'Second file',
    ]);
    expect(units.map((u) => u.id)).toEqual(['slide-3', 'slide-1', 'slide-2']);
  });

  it('reports whether a slide carries a picture, chart or table', () => {
    const pptx = buildPptx([
      { xml: imageSlidXml() },
      { xml: slideXml('Text only', 'body') },
    ]);

    const units = extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.hasPicture)).toEqual([true, false]);
  });

  it('emits a slide once even when the display order lists it twice', () => {
    const pptx = withPresentationOrder(
      buildPptx([{ xml: slideXml('A', 'a') }, { xml: slideXml('B', 'b') }]),
      [2, 1, 2]
    );

    const units = extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual(['B', 'A']);
  });

  it('reads a paragraph whose open tag is self-closing without swallowing the next one', () => {
    const xml = bodyOnlySlideXml(['Second']).replace('<a:p>', '<a:p/><a:p>');

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.paragraphs).toEqual(['Second']);
  });

  it('ignores an oversized part instead of inflating it', () => {
    const files = unzipSync(
      new Uint8Array(buildPptx([{ xml: slideXml('Small', 'a') }]))
    );
    files['ppt/slides/slide2.xml'] = new Uint8Array(MAX_PPTX_PART_BYTES + 1);
    files['docProps/junk.bin'] = new Uint8Array(MAX_PPTX_PART_BYTES + 1);

    const units = extractPptxSourceUnits(
      Buffer.from(zipSync(files, { level: 1 }))
    );

    expect(units.map((u) => u.title)).toEqual(['Small']);
  });

  it('refuses a deck whose needed parts exceed the total budget', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 9; i += 1) {
      files[`ppt/slides/slide${i}.xml`] = new Uint8Array(
        MAX_PPTX_PART_BYTES - 1
      );
    }

    expect(() =>
      extractPptxSourceUnits(Buffer.from(zipSync(files, { level: 1 })))
    ).toThrow(PptxTooLargeError);
  });

  it('reads a crafted slide of unterminated tags in linear time', () => {
    const junk = '<a:t<p:ph <p:sld <p:sldId <Relationship '.repeat(50_000);
    const xml = `<?xml version="1.0"?>
<p:sld xmlns:a="${NS_A}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:sp><p:txBody><a:p>${junk}</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const pptx = withPresentationOrder(buildPptx([{ xml }]), [1]);
    const files = unzipSync(new Uint8Array(pptx));
    files['ppt/presentation.xml'] = strToU8(
      `<p:presentation><p:sldIdLst>${junk}</p:sldIdLst></p:presentation>`
    );
    files['ppt/_rels/presentation.xml.rels'] = strToU8(
      `<Relationships>${junk}</Relationships>`
    );

    const started = Date.now();
    const units = extractPptxSourceUnits(Buffer.from(zipSync(files)));

    expect(Date.now() - started).toBeLessThan(2000);
    expect(units).toHaveLength(1);
    expect(units[0].paragraphs).toEqual([]);
  });

  it('keeps a tiny XML part whose deflate stream is larger than the text', () => {
    const files = unzipSync(
      new Uint8Array(buildPptx([{ xml: slideXml('Real', 'a') }]))
    );

    const units = extractPptxSourceUnits(
      Buffer.from(zipSync(files, { level: 9 }))
    );

    expect(units.map((u) => u.title)).toEqual(['Real']);
  });
});

function shapeXml(placeholder: string, paragraphs: string[]): string {
  return `<p:sp>
        <p:nvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>
        <p:txBody>
          ${paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('')}
        </p:txBody>
      </p:sp>`;
}

function fieldParagraphXml(fieldType: string, text: string): string {
  return `<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="${fieldType}"><a:rPr lang="en-US"/><a:t>${text}</a:t></a:fld></a:p>`;
}

function fieldShapeXml(
  placeholder: string,
  fieldType: string,
  text: string
): string {
  return `<p:sp>
        <p:nvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>
        <p:txBody>
          ${fieldParagraphXml(fieldType, text)}
        </p:txBody>
      </p:sp>`;
}

function slideNumberShapeXml(placeholder: string, slideNumber: string): string {
  return fieldShapeXml(placeholder, 'slidenum', slideNumber);
}

function slideOfShapesXml(shapes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS_A}" xmlns:p="${NS_P}">
  <p:cSld>
    <p:spTree>
      ${shapes.join('')}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

describe('extractPptxSourceUnits — slide chrome', () => {
  it.each([
    ['sldNum', '16'],
    ['dt', '10/6/2026'],
    ['ftr', 'Cell Biology, Lecture 3'],
    ['hdr', 'Draft for review'],
  ])('keeps the %s placeholder apart from the slide text', (type, text) => {
    const xml = slideOfShapesXml([
      shapeXml('<p:ph type="title"/>', ['Mitosis']),
      shapeXml('<p:ph idx="1"/>', ['Cell division']),
      shapeXml(`<p:ph type="${type}" sz="quarter" idx="12"/>`, [text]),
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.title).toBe('Mitosis');
    expect(unit.paragraphs).toEqual(['Cell division']);
    expect(unit.visibleText).toBe('Mitosis\nCell division');
    expect(unit.chromeParagraphs).toEqual([text]);
  });

  it('keeps a slide number drawn ahead of the text out of the paragraphs of an untitled slide', () => {
    const xml = slideOfShapesXml([
      slideNumberShapeXml('<p:ph idx="12" type="sldNum"/>', '19'),
      shapeXml('', ['Exocytosis', 'Ca2+ influx triggers fusion']),
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.title).toBe('');
    expect(unit.paragraphs).toEqual([
      'Exocytosis',
      'Ca2+ influx triggers fusion',
    ]);
    expect(unit.chromeParagraphs).toEqual(['19']);
  });

  it('keeps the chrome of a picture slide apart when it is the only text on the slide', () => {
    const xml = slideOfShapesXml([
      '<p:pic><p:nvPicPr><p:cNvPr name="image"/></p:nvPicPr></p:pic>',
      shapeXml('<p:ph type="ftr" sz="quarter" idx="11"/>', ['Cell Biology']),
      slideNumberShapeXml('<p:ph type="sldNum" sz="quarter" idx="12"/>', '7'),
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit).toMatchObject({
      title: '',
      paragraphs: [],
      chromeParagraphs: ['Cell Biology', '7'],
      visibleText: '',
      role: 'image',
      hasPicture: true,
    });
  });

  it('keeps a number typed into an ordinary text box', () => {
    const xml = slideOfShapesXml([
      shapeXml('', ['03']),
      shapeXml('', ['Endocytosis']),
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.paragraphs).toEqual(['03', 'Endocytosis']);
  });

  it('turns a numbered slide with no title into a card fronted by its heading', () => {
    const xml = slideOfShapesXml([
      slideNumberShapeXml('<p:ph type="sldNum" sz="quarter" idx="12"/>', '19'),
      shapeXml('', ['03']),
      shapeXml('', ['Exocytosis']),
      shapeXml('', ['Ca2+ influx triggers fusion']),
      shapeXml('<p:ph type="ftr" sz="quarter" idx="11"/>', ['Cell Biology']),
    ]);

    const html = combineSlidesIntoHTML(
      extractPptxSourceUnits(buildPptx([{ xml }])),
      ['/ws/pdf-x/slide-1.png'],
      'lecture.pdf',
      '/ws'
    );

    expect(html).toContain(
      '<summary>Exocytosis</summary><ul><li>03</li><li>Ca2+ influx triggers fusion</li></ul><img src="pdf-x/slide-1.png" /></details>'
    );
  });

  it.each([
    ['slidenum', '7'],
    ['datetime1', '10/6/2026'],
    ['datetimeFigureOut', '10/6/2026'],
  ])(
    'keeps a %s field inserted into an ordinary text box apart from the slide text',
    (fieldType, text) => {
      const xml = slideOfShapesXml([
        fieldShapeXml('', fieldType, text),
        shapeXml('', ['Exocytosis']),
      ]);

      const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

      expect(unit.paragraphs).toEqual(['Exocytosis']);
      expect(unit.visibleText).toBe('Exocytosis');
      expect(unit.chromeParagraphs).toEqual([text]);
    }
  );

  it('moves a line made only of a slide-number field out of a body placeholder', () => {
    const xml = slideOfShapesXml([
      shapeXml('<p:ph type="title"/>', ['Mitosis']),
      `<p:sp>
        <p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>Prophase</a:t></a:r></a:p>
          ${fieldParagraphXml('slidenum', '4')}
        </p:txBody>
      </p:sp>`,
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.title).toBe('Mitosis');
    expect(unit.paragraphs).toEqual(['Prophase']);
    expect(unit.chromeParagraphs).toEqual(['4']);
  });

  it('leaves a slide-number field line in the title placeholder out of the title', () => {
    const xml = slideOfShapesXml([
      `<p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>Mitosis</a:t></a:r></a:p>
          ${fieldParagraphXml('slidenum', '4')}
        </p:txBody>
      </p:sp>`,
      shapeXml('<p:ph idx="1"/>', ['Prophase']),
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.title).toBe('Mitosis');
    expect(unit.chromeParagraphs).toEqual(['4']);
  });

  it('keeps a line that mixes typed words with a slide-number field as slide text', () => {
    const xml = slideOfShapesXml([
      `<p:sp>
        <p:nvSpPr><p:nvPr/></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>Slide </a:t></a:r><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:t>4</a:t></a:fld></a:p>
        </p:txBody>
      </p:sp>`,
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.paragraphs).toEqual(['Slide 4']);
    expect(unit.chromeParagraphs).toEqual([]);
  });

  it('answers a picture slide whose slide number sits in an ordinary text box with that number', () => {
    const xml = slideOfShapesXml([
      '<p:pic><p:nvPicPr><p:cNvPr name="image"/></p:nvPicPr></p:pic>',
      fieldShapeXml('', 'slidenum', '7'),
    ]);

    const html = combineSlidesIntoHTML(
      extractPptxSourceUnits(buildPptx([{ xml }])),
      ['/ws/pdf-x/slide-1.png'],
      'lecture.pdf',
      '/ws'
    );

    expect(html).toContain(
      '<summary><img src="pdf-x/slide-1.png" /></summary><ul><li>7</li></ul></details>'
    );
  });

  it('lists a slide number once when the placeholder is stored twice for older PowerPoint versions', () => {
    const slideNumber = slideNumberShapeXml(
      '<p:ph type="sldNum" sz="quarter" idx="12"/>',
      '4'
    );
    const xml = slideOfShapesXml([
      shapeXml('<p:ph type="title"/>', ['Mitosis']),
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
        <mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">${slideNumber}</mc:Choice>
        <mc:Fallback>${slideNumber}</mc:Fallback>
      </mc:AlternateContent>`,
    ]);

    const [unit] = extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.title).toBe('Mitosis');
    expect(unit.chromeParagraphs).toEqual(['4']);
  });
});

describe('extractPptxSourceUnits — the slide read as it was before chrome detection', () => {
  const footer = shapeXml('<p:ph type="ftr" sz="quarter" idx="11"/>', [
    'Cell Biology',
  ]);
  const slideNumber = (n: string) =>
    slideNumberShapeXml('<p:ph type="sldNum" sz="quarter" idx="12"/>', n);

  const chromeOnlyLecture = buildPptx([
    {
      xml: slideOfShapesXml([
        fieldShapeXml(
          '<p:ph type="dt" sz="half" idx="10"/>',
          'datetime1',
          '10/27/2026'
        ),
        footer,
        slideNumber('1'),
      ]),
    },
    {
      xml: slideOfShapesXml([
        footer,
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
        <mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">${slideNumber('2')}</mc:Choice>
        <mc:Fallback>${slideNumber('2')}</mc:Fallback>
      </mc:AlternateContent>`,
      ]),
    },
    {
      xml: slideOfShapesXml([fieldShapeXml('', 'slidenum', '3'), footer]),
      notesXml: notesXml('Label the four phases'),
    },
    {
      xml: slideOfShapesXml([
        footer,
        fieldShapeXml('<p:ph type="title"/>', 'slidenum', '4'),
      ]),
    },
  ]);

  it('reads every line with chrome as ordinary text: title first, then the order the slide stores them, duplicates kept', () => {
    const units = extractPptxSourceUnits(chromeOnlyLecture);

    expect(units.map((unit) => unit.textWithChrome)).toEqual([
      ['10/27/2026', 'Cell Biology', '1'],
      ['Cell Biology', '2', '2'],
      ['3', 'Cell Biology'],
      ['4', 'Cell Biology'],
    ]);
  });
});

const TITLE_SLIDE_AND_FIGURES_BEFORE_CHROME_DETECTION = `<!DOCTYPE html>
<html>
<head><title>lecture.pptx</title></head>
<body>
  <ul class="toggle">
    <li>
      <details>
        <summary>Mitosis</summary></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>Cell Biology</summary><ul><li>2</li></ul></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>Cell Biology</summary><ul><li>3</li></ul></details>
    </li>
    </ul>
</body>
</html>`;

const TITLED_SLIDES_BEFORE_CHROME_DETECTION = `<!DOCTYPE html>
<html>
<head><title>lecture.pptx</title></head>
<body>
  <ul class="toggle">
    <li>
      <details>
        <summary>Mitosis</summary><ul><li>Prophase</li><li>Cell Biology</li><li>1</li></ul></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>Meiosis 2</summary><ul><li>Gametes</li><li>10/27/2026</li></ul></details>
    </li>
    </ul>
</body>
</html>`;

const NOTES_SLIDE_BEFORE_CHROME_DETECTION = `<!DOCTYPE html>
<html>
<head><title>lecture.pptx</title></head>
<body>
  <ul class="toggle">
    <li>
      <details>
        <summary>Mitosis</summary><ul><li>Prophase</li><li>Cell Biology</li><li>1</li></ul></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>Cell Biology</summary><ul><li>2</li></ul><hr /><p>Label the four phases</p></details>
    </li>
    </ul>
</body>
</html>`;

const PARTLY_RENDERED_BEFORE_CHROME_DETECTION = `<!DOCTYPE html>
<html>
<head><title>lecture.pdf</title></head>
<body>
  <ul class="toggle">
    <li>
      <details>
        <summary>19</summary><ul><li>03</li><li>Exocytosis</li><li>Cell Biology</li></ul><img src="pdf-x/slide-1.png" /></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary><img src="pdf-x/slide-2.png" /></summary></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>Cell Biology</summary><ul><li>21</li></ul></details>
    </li>
    </ul>
</body>
</html>`;

const EVERY_SLIDE_RENDERED_BEFORE_CHROME_DETECTION = `<!DOCTYPE html>
<html>
<head><title>lecture.pdf</title></head>
<body>
  <ul class="toggle">
    <li>
      <details>
        <summary>Mitosis</summary><ul><li>Prophase</li><li>Cell Biology</li><li>1</li></ul><img src="pdf-x/slide-1.png" /></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>Cell Biology</summary><ul><li>2</li></ul><img src="pdf-x/slide-2.png" /></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>3</summary><img src="pdf-x/slide-3.png" /></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary>19</summary><ul><li>03</li><li>Exocytosis</li><li>Cell Biology</li></ul><img src="pdf-x/slide-4.png" /></details>
    </li>
    </ul>
<ul class="toggle">
    <li>
      <details>
        <summary><img src="pdf-x/slide-5.png" /></summary></details>
    </li>
    </ul>
</body>
</html>`;

describe('extractPptxSourceUnits — a .pptx whose slide images do not all reach its cards converts exactly as before chrome detection', () => {
  const footer = shapeXml('<p:ph type="ftr" sz="quarter" idx="11"/>', [
    'Cell Biology',
  ]);
  const slideNumber = (n: string) =>
    slideNumberShapeXml('<p:ph type="sldNum" sz="quarter" idx="12"/>', n);
  const picture =
    '<p:pic><p:nvPicPr><p:cNvPr name="image"/></p:nvPicPr></p:pic>';
  const titledSlide = slideOfShapesXml([
    shapeXml('<p:ph type="title"/>', ['Mitosis']),
    shapeXml('<p:ph idx="1"/>', ['Prophase']),
    footer,
    slideNumber('1'),
  ]);

  it('makes the cards it made before from a title slide and figure slides whose only text is the footer and slide number, with slide images off', () => {
    const lecture = buildPptx([
      {
        xml: slideOfShapesXml([
          shapeXml('<p:ph type="ctrTitle"/>', ['Mitosis']),
        ]),
      },
      { xml: slideOfShapesXml([picture, footer, slideNumber('2')]) },
      { xml: slideOfShapesXml([picture, footer, slideNumber('3')]) },
    ]);

    const html = combineSlidesIntoHTML(
      extractPptxSourceUnits(lecture),
      [],
      'lecture.pptx'
    );

    expect(html).toBe(TITLE_SLIDE_AND_FIGURES_BEFORE_CHROME_DETECTION);
  });

  it('keeps the slide number, date and footer of titled slides as slide text, with slide images off', () => {
    const lecture = buildPptx([
      { xml: titledSlide },
      {
        xml: slideOfShapesXml([
          `<p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:t>Meiosis</a:t></a:r></a:p>
          ${fieldParagraphXml('slidenum', '2')}
        </p:txBody>
      </p:sp>`,
          shapeXml('<p:ph idx="1"/>', ['Gametes']),
          fieldShapeXml(
            '<p:ph type="dt" sz="half" idx="10"/>',
            'datetime1',
            '10/27/2026'
          ),
        ]),
      },
    ]);

    const html = combineSlidesIntoHTML(
      extractPptxSourceUnits(lecture),
      [],
      'lecture.pptx'
    );

    expect(html).toBe(TITLED_SLIDES_BEFORE_CHROME_DETECTION);
  });

  it('keeps the card a slide whose only text is chrome made with its speaker notes, with slide images off', () => {
    const lecture = buildPptx([
      { xml: titledSlide },
      {
        xml: slideOfShapesXml([footer, slideNumber('2')]),
        notesXml: notesXml('Label the four phases'),
      },
    ]);

    const html = combineSlidesIntoHTML(
      extractPptxSourceUnits(lecture),
      [],
      'lecture.pptx'
    );

    expect(html).toBe(NOTES_SLIDE_BEFORE_CHROME_DETECTION);
  });

  describe('when fewer pages rendered than slides', () => {
    const partlyRendered = buildPptx([
      {
        xml: slideOfShapesXml([
          slideNumber('19'),
          shapeXml('', ['03']),
          shapeXml('', ['Exocytosis']),
          footer,
        ]),
      },
      { xml: slideOfShapesXml([picture]) },
      { xml: slideOfShapesXml([picture, footer, slideNumber('21')]) },
      { xml: slideOfShapesXml([picture]) },
    ]);
    const renderedPages = ['/ws/pdf-x/slide-1.png', '/ws/pdf-x/slide-2.png'];

    function convert(): string {
      return combineSlidesIntoHTML(
        extractPptxSourceUnits(partlyRendered),
        renderedPages,
        'lecture.pdf',
        '/ws'
      );
    }

    it('puts each rendered page where it went before chrome detection', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        expect(convert()).toBe(PARTLY_RENDERED_BEFORE_CHROME_DETECTION);
      } finally {
        warn.mockRestore();
      }
    });

    it('warns only about the slide with no text and no rendered page', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        convert();

        expect(warn.mock.calls).toEqual([
          [
            '[combineSlidesIntoHTML] slide has nothing to show',
            { slide: 'slide-4' },
          ],
        ]);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('when embedded images are off', () => {
    it('builds every card as it did then, each rendered page where it went then', () => {
      const lecture = buildPptx([
        { xml: titledSlide },
        { xml: slideOfShapesXml([picture, footer, slideNumber('2')]) },
        {
          xml: slideOfShapesXml([
            fieldShapeXml('<p:ph type="title"/>', 'slidenum', '3'),
            picture,
          ]),
        },
        {
          xml: slideOfShapesXml([
            slideNumber('19'),
            shapeXml('', ['03']),
            shapeXml('', ['Exocytosis']),
            footer,
          ]),
        },
        { xml: slideOfShapesXml([picture]) },
      ]);
      const renderedPages = [1, 2, 3, 4, 5].map(
        (n) => `/ws/pdf-x/slide-${n}.png`
      );

      const html = combineSlidesWithChromeIntoHTML(
        extractPptxSourceUnits(lecture),
        renderedPages,
        'lecture.pdf',
        '/ws'
      );

      expect(html).toBe(EVERY_SLIDE_RENDERED_BEFORE_CHROME_DETECTION);
    });
  });
});
