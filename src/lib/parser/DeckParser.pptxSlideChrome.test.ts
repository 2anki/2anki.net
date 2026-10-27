import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { setupTests } from '../../test/configure-jest';
import { combineSlidesIntoHTML } from '../pdf/combineSlidesIntoHTML';
import { DeckParser } from './DeckParser';
import CardOption from './Settings/CardOption';
import { extractPptxSourceUnits } from './sourceUnits/extractPptxSourceUnits';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const SLIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function textShape(placeholder: string, text: string): string {
  return `<p:sp><p:nvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function slideXml(shapes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NAMESPACES}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;
}

const footer = textShape(
  '<p:ph type="ftr" sz="quarter" idx="11"/>',
  'Cell Biology'
);
const slideNumber = (n: string) =>
  textShape('<p:ph type="sldNum" sz="quarter" idx="12"/>', n);
const picture =
  '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Diagram"/></p:nvPicPr></p:pic>';

const lecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': strToU8(
      slideXml([
        textShape('<p:ph type="title"/>', 'Mitosis'),
        textShape('<p:ph idx="1"/>', 'Prophase'),
        footer,
        slideNumber('1'),
      ])
    ),
    'ppt/slides/slide2.xml': strToU8(
      slideXml([picture, footer, slideNumber('2')])
    ),
  })
);

async function convertLecture(cloze: 'true' | 'false') {
  const workspace = new Workspace(true, 'fs');
  const slides = extractPptxSourceUnits(lecture);
  const imageNames = slides.map((_, i) => `pdf-lecture/slide-${i + 1}.png`);
  fs.mkdirSync(path.join(workspace.location, 'pdf-lecture'), {
    recursive: true,
  });
  const imagePaths = imageNames.map((name) => {
    const imagePath = path.join(workspace.location, name);
    fs.writeFileSync(imagePath, SLIDE_PNG);
    return imagePath;
  });
  const html = combineSlidesIntoHTML(
    slides,
    imagePaths,
    'lecture.pdf',
    workspace.location
  );
  const parser = new DeckParser({
    name: 'lecture.pptx.html',
    settings: new CardOption({ cloze }),
    files: [
      { name: 'lecture.pptx.html', contents: Buffer.from(html) },
      ...imageNames.map((name) => ({ name, contents: SLIDE_PNG })),
    ],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser;
}

function visibleText(html: string): string {
  return html
    .replaceAll(/<img[^>]*>/g, ' [slide image] ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

describe('a PowerPoint lecture with slide numbers and a footer on every slide', () => {
  it.each(['true', 'false'])(
    'keeps the diagram slide as a card with an answer (cloze %s)',
    async (cloze) => {
      const parser = await convertLecture(cloze as 'true' | 'false');

      expect(parser.emptyBackCount).toBe(0);
      expect(
        parser.payload[0].cards.map((card) => ({
          front: visibleText(card.name),
          back: visibleText(card.back),
        }))
      ).toEqual([
        { front: 'Mitosis', back: 'Prophase [slide image]' },
        { front: '[slide image]', back: 'Cell Biology 2' },
      ]);
    }
  );
});
