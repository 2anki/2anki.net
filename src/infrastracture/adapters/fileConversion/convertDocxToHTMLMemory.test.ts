import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MAX_OLD_GENERATION_SIZE_MB } from '../../../lib/conversionMemoryLimits';
import {
  buildDocx,
  docxImageRun,
  docxParagraph,
  docxRun,
  type DocxImage,
} from '../../../test/fakes/buildDocx';

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

// A term's worth of lecture notes typed in Word, about 9.5 MB on disk: 80
// figures and a long body whose document.xml unpacks to about 42 MB.
function longLectureNotes(): Buffer {
  const words = seededWords();
  const images: DocxImage[] = Array.from({ length: 80 }, (_, i) => ({
    id: `fig${i}`,
    bytes: seededImage(105_000, i + 1),
  }));
  const body: string[] = [];
  for (let section = 0; section < 3000; section++) {
    body.push(docxParagraph(docxRun(words(5)), { style: 'Heading2' }));
    for (let p = 0; p < 10; p++) {
      const runs = Array.from({ length: 6 }, (_, r) =>
        docxRun(`${words(6)} `, { bold: r === 0 })
      ).join('');
      body.push(docxParagraph(runs, p % 4 === 1 ? { listId: '1' } : {}));
    }
    if (section % 37 === 0 && section / 37 < images.length) {
      body.push(docxParagraph(docxImageRun(`fig${section / 37}`)));
    }
  }
  return buildDocx({ body: body.join(''), images });
}

describe('convertDocxToHTML memory', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-memory-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Measured locally: converting this document whole needs about 1.7 GB of
  // old space; converted in pieces the whole upload path fits well under the
  // conversion child's 1 GB ceiling.
  it('converts long Word lecture notes within the conversion child heap', () => {
    const docxPath = path.join(dir, 'notes.docx');
    const docx = longLectureNotes();
    expect(docx.length).toBeGreaterThan(9_000_000);
    fs.writeFileSync(docxPath, docx);
    const script = `
      process.env.WORKSPACE_BASE = ${JSON.stringify(dir)};
      console.log = () => {};
      console.info = () => {};
      const fs = require('fs');
      const { prepareDeckInfoOnly } = require(${JSON.stringify(path.join(__dirname, 'PrepareDeck.ts'))});
      const CardOption = require(${JSON.stringify(path.join(__dirname, '../../../lib/parser/Settings/index.ts'))}).default;
      const Workspace = require(${JSON.stringify(path.join(__dirname, '../../../lib/parser/WorkSpace.ts'))}).default;
      prepareDeckInfoOnly(
        {
          name: 'notes.docx',
          settings: new CardOption(CardOption.LoadDefaultOptions()),
          files: [{ name: 'notes.docx', contents: fs.readFileSync(${JSON.stringify(docxPath)}) }],
          noLimits: false,
          workspace: new Workspace(true, 'fs'),
        },
        new Workspace(true, 'fs'),
        new Workspace(true, 'fs')
      ).then((result) => process.stdout.write('CARDS=' + result.cardCount));
    `;

    const child = spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${MAX_OLD_GENERATION_SIZE_MB}`,
        '--require',
        'tsx/cjs',
        '-e',
        script,
      ],
      { encoding: 'utf8', timeout: 150000 }
    );

    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stdout).toMatch(/CARDS=12000$/);
  }, 180000);
});
