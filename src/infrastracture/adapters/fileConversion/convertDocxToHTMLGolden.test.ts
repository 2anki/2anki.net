import mammoth from 'mammoth';

import { convertDocxToHTML } from './convertDocxToHTML';
import { DOCX_BODY_CHUNK_BYTES, splitDocxBody } from './docxBodyChunks';
import { preprocessDocxHTML } from './preprocessDocxHTML';
import {
  buildDocx,
  docxFootnoteReference,
  docxImageRun,
  docxParagraph,
  docxRun,
  docxTable,
} from '../../../test/fakes/buildDocx';
import type { DocxImageMediaSink } from './docxImageMediaSink';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const figureSink: DocxImageMediaSink = { write: () => 'figure.png' };

function studyNotes(): Buffer {
  const body = [
    docxParagraph(docxRun('Cell biology'), { style: 'Heading1' }),
    docxParagraph(
      docxRun('Mitochondria ', { bold: true }) +
        docxRun('make ATP', { strike: true }) +
        docxFootnoteReference('1')
    ),
    docxParagraph(docxRun('Inner membrane'), { listId: '1' }),
    docxParagraph(docxRun('Matrix'), { listId: '1' }),
    docxParagraph(docxRun('Glycolysis'), { listId: '2' }),
    docxTable([
      ['Organelle', 'Role'],
      ['Ribosome', 'Translation'],
    ]),
    docxParagraph(docxImageRun('img1')),
    docxParagraph(docxRun('Membranes'), { style: 'Heading2' }),
    docxParagraph(docxRun('Phospholipid bilayer')),
  ].join('');
  return buildDocx({
    body,
    images: [{ id: 'img1', bytes: PNG_BYTES }],
    footnotes: { '1': 'Mostly' },
  });
}

function longStudyNotes(): Buffer {
  const sections: string[] = [];
  for (let i = 0; i < 2200; i++) {
    sections.push(
      docxParagraph(docxRun(`Lecture ${i}`), { style: 'Heading2' }),
      docxParagraph(
        docxRun(`Key idea ${i} `, { bold: true }) +
          docxRun(`explained in a sentence about topic ${i}.`) +
          (i % 50 === 0 ? docxFootnoteReference(`${i + 1}`) : '')
      ),
      docxParagraph(docxRun(`Point ${i}a`), { listId: '1' }),
      docxParagraph(docxRun(`Point ${i}b`), { listId: '1' }),
      docxTable([[`term ${i}`, `meaning ${i}`]])
    );
  }
  const footnotes: Record<string, string> = {};
  for (let i = 0; i < 2200; i += 50) footnotes[`${i + 1}`] = `Source ${i}`;
  return buildDocx({ body: sections.join(''), footnotes });
}

// Captured from the converter before long documents were split, so a change
// to the way short documents convert shows up here.
const STUDY_NOTES_HTML =
  '<html><head></head><body><details><summary>Cell biology</summary><p><strong>Mitochondria </strong><del>make ATP</del><sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p><ul><li>Inner membrane</li><li>Matrix</li></ul><ol><li>Glycolysis</li></ol><table><tbody><tr><td><p>Organelle</p></td><td><p>Role</p></td></tr><tr><td><p>Ribosome</p></td><td><p>Translation</p></td></tr></tbody></table><p><img src="figure.png"></p></details><details><summary>Membranes</summary><p>Phospholipid bilayer</p><ol><li id="footnote-1"><p>Mostly <a href="#footnote-ref-1">↑</a></p></li></ol></details></body></html>';

const STUDY_NOTES_FAN_OUT_HTML =
  '<html><head></head><body><details><summary>Cell biology</summary><p><strong>Mitochondria </strong><del>make ATP</del><sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p><table><tbody><tr><td><p>Organelle</p></td><td><p>Role</p></td></tr><tr><td><p>Ribosome</p></td><td><p>Translation</p></td></tr></tbody></table><p><img src="figure.png"></p></details><details><summary>Cell biology — 1/3</summary>Inner membrane</details><details><summary>Cell biology — 2/3</summary>Matrix</details><details><summary>Cell biology — 3/3</summary>Glycolysis</details><details><summary>Membranes</summary><p>Phospholipid bilayer</p></details><details><summary>Membranes</summary><p>Mostly <a href="#footnote-ref-1">↑</a></p></details></body></html>';

describe('convertDocxToHTML output', () => {
  it('converts short study notes to the same HTML as before', async () => {
    expect(await convertDocxToHTML(studyNotes(), figureSink)).toBe(
      STUDY_NOTES_HTML
    );
  });

  it('converts short study notes with bullet fan-out to the same HTML as before', async () => {
    expect(
      await convertDocxToHTML(studyNotes(), figureSink, { bulletFanOut: true })
    ).toBe(STUDY_NOTES_FAN_OUT_HTML);
  });

  it('converts a document longer than one piece to the HTML of converting it whole', async () => {
    const docx = longStudyNotes();
    expect(splitDocxBody(docx, DOCX_BODY_CHUNK_BYTES)?.count).toBeGreaterThan(
      1
    );
    const whole = await mammoth.convertToHtml(
      { buffer: docx },
      { styleMap: ['strike => del'] }
    );

    const html = await convertDocxToHTML(docx);

    expect(html).toBe(preprocessDocxHTML(whole.value));
    expect(html).toContain('id="footnote-ref-2151">[44]</a>');
  }, 60000);
});
