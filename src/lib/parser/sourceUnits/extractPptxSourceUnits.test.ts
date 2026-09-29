import { strToU8, unzipSync, zipSync } from 'fflate';
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
  it('returns one unit per slide with title and body text', async () => {
    const pptx = buildPptx([{ xml: slideXml('Slide One', 'Body text here') }]);

    const units = await extractPptxSourceUnits(pptx);

    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: 'slide-1',
      role: 'title',
      visibleText: 'Slide One\nBody text here',
      speakerNotes: '',
    });
  });

  it('assigns stable sequential IDs slide-1, slide-2, slide-3', async () => {
    const pptx = buildPptx([
      { xml: slideXml('A', 'a') },
      { xml: slideXml('B', 'b') },
      { xml: slideXml('C', 'c') },
    ]);

    const units = await extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.id)).toEqual(['slide-1', 'slide-2', 'slide-3']);
  });

  it('attaches speaker notes to the corresponding slide unit', async () => {
    const pptx = buildPptx([
      {
        xml: slideXml('Mitosis', 'Cell division'),
        notesXml: notesXml(
          'Remember: prophase, metaphase, anaphase, telophase'
        ),
      },
    ]);

    const units = await extractPptxSourceUnits(pptx);

    expect(units[0].speakerNotes).toBe(
      'Remember: prophase, metaphase, anaphase, telophase'
    );
  });

  it('returns empty array for a PPTX with no slides', async () => {
    const pptx = Buffer.from(
      zipSync({ 'ppt/presentation.xml': strToU8('<root/>') })
    );

    const units = await extractPptxSourceUnits(pptx);

    expect(units).toEqual([]);
  });

  it('assigns role image for slides with no text shapes', async () => {
    const pptx = buildPptx([{ xml: imageSlidXml() }]);

    const units = await extractPptxSourceUnits(pptx);

    expect(units[0]).toMatchObject({
      id: 'slide-1',
      role: 'image',
      visibleText: '',
      speakerNotes: '',
    });
  });

  it('handles multiple text runs within a paragraph', async () => {
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

    const units = await extractPptxSourceUnits(pptx);

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
  it('keeps the title apart from the body paragraphs', async () => {
    const pptx = buildPptx([{ xml: slideXml('Mitosis', 'Cell division') }]);

    const [unit] = await extractPptxSourceUnits(pptx);

    expect(unit.title).toBe('Mitosis');
    expect(unit.paragraphs).toEqual(['Cell division']);
  });

  it('keeps each bullet as its own paragraph', async () => {
    const pptx = buildPptx([
      { xml: bodyOnlySlideXml(['Prophase', 'Metaphase', 'Anaphase']) },
    ]);

    const [unit] = await extractPptxSourceUnits(pptx);

    expect(unit.title).toBe('');
    expect(unit.paragraphs).toEqual(['Prophase', 'Metaphase', 'Anaphase']);
  });

  it('treats a centred title placeholder as the title', async () => {
    const xml = slideXml('Welcome', 'Agenda').replace(
      'type="title"',
      'type="ctrTitle"'
    );

    const [unit] = await extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.title).toBe('Welcome');
  });

  it('drops hidden slides so units line up with the exported PDF pages', async () => {
    const pptx = buildPptx([
      { xml: slideXml('One', 'a') },
      { xml: hiddenSlideXml('Hidden') },
      { xml: slideXml('Three', 'c') },
    ]);

    const units = await extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual(['One', 'Three']);
  });

  it('also drops slides hidden with show="false"', async () => {
    const pptx = buildPptx([
      { xml: slideXml('One', 'a') },
      {
        xml: slideXml('Hidden', 'b').replace('<p:sld ', '<p:sld show="false" '),
      },
    ]);

    const units = await extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual(['One']);
  });

  it('follows the presentation display order, not the slide file numbers', async () => {
    const pptx = withPresentationOrder(
      buildPptx([
        { xml: slideXml('First file', 'a') },
        { xml: slideXml('Second file', 'b') },
        { xml: slideXml('Third file', 'c') },
      ]),
      [3, 1, 2]
    );

    const units = await extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual([
      'Third file',
      'First file',
      'Second file',
    ]);
    expect(units.map((u) => u.id)).toEqual(['slide-3', 'slide-1', 'slide-2']);
  });

  it('reports whether a slide carries a picture, chart or table', async () => {
    const pptx = buildPptx([
      { xml: imageSlidXml() },
      { xml: slideXml('Text only', 'body') },
    ]);

    const units = await extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.hasPicture)).toEqual([true, false]);
  });

  it('emits a slide once even when the display order lists it twice', async () => {
    const pptx = withPresentationOrder(
      buildPptx([{ xml: slideXml('A', 'a') }, { xml: slideXml('B', 'b') }]),
      [2, 1, 2]
    );

    const units = await extractPptxSourceUnits(pptx);

    expect(units.map((u) => u.title)).toEqual(['B', 'A']);
  });

  it('reads a paragraph whose open tag is self-closing without swallowing the next one', async () => {
    const xml = bodyOnlySlideXml(['Second']).replace('<a:p>', '<a:p/><a:p>');

    const [unit] = await extractPptxSourceUnits(buildPptx([{ xml }]));

    expect(unit.paragraphs).toEqual(['Second']);
  });

  it('ignores an oversized part instead of inflating it', async () => {
    const files = unzipSync(
      new Uint8Array(buildPptx([{ xml: slideXml('Small', 'a') }]))
    );
    files['ppt/slides/slide2.xml'] = new Uint8Array(MAX_PPTX_PART_BYTES + 1);
    files['docProps/junk.bin'] = new Uint8Array(MAX_PPTX_PART_BYTES + 1);

    const units = await extractPptxSourceUnits(
      Buffer.from(zipSync(files, { level: 1 }))
    );

    expect(units.map((u) => u.title)).toEqual(['Small']);
  });

  it('refuses a deck whose needed parts exceed the total budget', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 9; i += 1) {
      files[`ppt/slides/slide${i}.xml`] = new Uint8Array(
        MAX_PPTX_PART_BYTES - 1
      );
    }

    await expect(
      extractPptxSourceUnits(Buffer.from(zipSync(files, { level: 1 })))
    ).rejects.toBeInstanceOf(PptxTooLargeError);
  });

  it('reads a crafted slide of unterminated tags in linear time', async () => {
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
    const units = await extractPptxSourceUnits(Buffer.from(zipSync(files)));

    expect(Date.now() - started).toBeLessThan(2000);
    expect(units).toHaveLength(1);
    expect(units[0].paragraphs).toEqual([]);
  });

  it('keeps a tiny XML part whose deflate stream is larger than the text', async () => {
    const files = unzipSync(
      new Uint8Array(buildPptx([{ xml: slideXml('Real', 'a') }]))
    );

    const units = await extractPptxSourceUnits(
      Buffer.from(zipSync(files, { level: 9 }))
    );

    expect(units.map((u) => u.title)).toEqual(['Real']);
  });
});
