import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MAX_OLD_GENERATION_SIZE_MB } from '../../../lib/conversionMemoryLimits';
import { ConversionChildCrashedError } from '../../../lib/workerTermination';
import { jobFailureReasonFromError } from '../../../usecases/jobs/jobFailureReason';
import { DOCX_BODY_CHUNK_BYTES, splitDocxBody } from './docxBodyChunks';
import {
  longBulletedNotes,
  longGlossaryTable,
  longLectureNotes,
} from '../../../test/fakes/longWordDocuments';

function prepareDeckScript(dir: string, docxPath: string): string {
  return `
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
}

function runChild(heapMb: number, script: string) {
  return spawnSync(
    process.execPath,
    [`--max-old-space-size=${heapMb}`, '--require', 'tsx/cjs', '-e', script],
    { encoding: 'utf8', timeout: 150000 }
  );
}

describe('convertDocxToHTML memory', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-memory-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Measured locally: converting either document whole needs over 1.5 GB of
  // old space; converted in pieces the whole upload path needs under 300 MB.
  it.each([
    ['long Word lecture notes', longLectureNotes, 12000],
    ['long bulleted Word notes', longBulletedNotes, 44080],
  ])(
    'converts %s within the conversion child heap',
    (_name, build, cards) => {
      const docxPath = path.join(dir, 'notes.docx');
      const docx = build();
      expect(docx.length).toBeGreaterThan(9_000_000);
      fs.writeFileSync(docxPath, docx);

      const child = runChild(
        MAX_OLD_GENERATION_SIZE_MB,
        prepareDeckScript(dir, docxPath)
      );

      expect(child.signal).toBeNull();
      expect(child.status).toBe(0);
      expect(child.stdout).toMatch(new RegExp(`CARDS=${cards}$`));
    },
    180000
  );

  // A document with no place to cut converts whole, as it did before pieces,
  // so past the heap it fails the way it always has: the child aborts and the
  // visitor is told to split the file. Scaled down to a small heap.
  it('fails a long document it cannot cut the way it did before, with the split-the-file reason', () => {
    const docx = longGlossaryTable(6000);
    expect(splitDocxBody(docx, DOCX_BODY_CHUNK_BYTES)).toBeNull();
    const convert = (rows: number) => {
      const docxPath = path.join(dir, `glossary-${rows}.docx`);
      fs.writeFileSync(
        docxPath,
        rows === 6000 ? docx : longGlossaryTable(rows)
      );
      return runChild(
        128,
        `
        const fs = require('fs');
        const { convertDocxToHTML } = require(${JSON.stringify(path.join(__dirname, 'convertDocxToHTML.ts'))});
        convertDocxToHTML(fs.readFileSync(${JSON.stringify(docxPath)})).then(() => process.stdout.write('CONVERTED'));
      `
      );
    };

    expect(convert(50).stdout).toBe('CONVERTED');
    const child = convert(6000);

    expect(child.signal).toBe('SIGABRT');
    const crash = new ConversionChildCrashedError({
      exitCode: child.status,
      signal: child.signal,
      lastRssBytes: null,
      reason: 'conversion_process_crashed',
    });
    expect(jobFailureReasonFromError(crash, 'job-glossary')).toBe(
      'This file is too large to convert in one go. Split it into smaller files and convert each one separately.'
    );
  }, 120000);
});
