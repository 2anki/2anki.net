import { unzipSync } from 'fflate';

import {
  buildDocx,
  docxImageRun,
  docxParagraph,
  docxRun,
  type DocxImage,
} from './buildDocx';

const VOCABULARY =
  'cell protein membrane receptor kinase signal pathway enzyme substrate binding mitochondria nucleus chromosome replication transcription translation ribosome glucose insulin hormone neuron synapse potential sodium potassium calcium channel artery pressure kidney filtration liver immune antibody antigen inflammation infection diagnosis symptom clinical'.split(
    ' '
  );

function seededWords() {
  let seed = 20261125;
  return (count: number) => {
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      words.push(VOCABULARY[seed % VOCABULARY.length]);
    }
    return words.join(' ');
  };
}

function seededImage(size: number, salt: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let seed = salt;
  for (let i = 0; i < size; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = seed >>> 16;
  }
  return bytes;
}

function figures(): DocxImage[] {
  return Array.from({ length: 80 }, (_, i) => ({
    id: `fig${i}`,
    bytes: seededImage(105_000, i + 1),
  }));
}

function runsOf(words: (count: number) => string): string {
  return Array.from({ length: 6 }, (_, r) =>
    docxRun(`${words(6)} `, { bold: r === 0 })
  ).join('');
}

// A term's worth of lecture notes typed in Word, about 9.5 MB on disk: 80
// figures and 3000 headed sections whose document.xml unpacks to about 42 MB.
export function longLectureNotes(sections = 3000): Buffer {
  const words = seededWords();
  const images = figures();
  const body: string[] = [];
  for (let section = 0; section < sections; section++) {
    body.push(docxParagraph(docxRun(words(5)), { style: 'Heading2' }));
    for (let p = 0; p < 10; p++) {
      body.push(
        docxParagraph(runsOf(words), p % 4 === 1 ? { listId: '1' } : {})
      );
    }
    if (section % 37 === 0 && section / 37 < images.length) {
      body.push(docxParagraph(docxImageRun(`fig${section / 37}`)));
    }
  }
  return buildDocx({ body: body.join(''), images });
}

// The same notes kept as one bulleted outline with no headings: every
// paragraph a list item, a third of them nested one level.
export function longBulletedNotes(items = 33000): Buffer {
  const words = seededWords();
  const images = figures();
  const body: string[] = [];
  for (let item = 0; item < items; item++) {
    body.push(
      docxParagraph(runsOf(words), {
        listId: '1',
        level: item % 3 === 2 ? 1 : 0,
      })
    );
    if (item % 410 === 0 && item / 410 < images.length) {
      body.push(
        docxParagraph(docxImageRun(`fig${item / 410}`), { listId: '1' })
      );
    }
  }
  return buildDocx({ body: body.join(''), images });
}

function bodyXmlBytes(docx: Buffer): number {
  let size = 0;
  unzipSync(new Uint8Array(docx), {
    filter: (file) => {
      if (file.name === 'word/document.xml') size = file.originalSize;
      return false;
    },
  });
  return size;
}

// A short note whose word/document.xml is exactly `bytes` long, padded with
// an XML comment the converter skips.
export function wordNotesWithBodyBytes(bytes: number): Buffer {
  const note = docxParagraph(docxRun('A short note.'));
  const base = bodyXmlBytes(buildDocx({ body: note }));
  const padding = bytes - base - '<!---->'.length;
  if (padding < 0) throw new Error(`a body of ${bytes} bytes is too short`);
  return buildDocx({ body: `${note}<!--${'x'.repeat(padding)}-->` });
}
