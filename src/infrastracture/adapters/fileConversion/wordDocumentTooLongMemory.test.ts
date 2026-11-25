import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MAX_OLD_GENERATION_SIZE_MB } from '../../../lib/conversionMemoryLimits';
import { ConversionChildCrashedError } from '../../../lib/workerTermination';
import { jobFailureReasonFromError } from '../../../usecases/jobs/jobFailureReason';
import {
  longBulletedNotes,
  longLectureNotes,
} from '../../../test/fakes/longWordDocuments';

// The two production-shaped documents crash the 1 GB conversion child on the
// whole-file path (they need about 1.6 and 1.7 GB of old space). Here they
// are refused before the converter starts.
describe('a Word file too long to convert, in the conversion child', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-too-long-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['lecture notes with figures', longLectureNotes],
    ['bulleted notes with figures', longBulletedNotes],
  ])(
    'refuses %s at about 9.5 MB in well under a second, without crashing',
    (_name, build) => {
      const docx = build();
      expect(docx.length).toBeGreaterThan(9_000_000);
      const docxPath = path.join(dir, 'notes.docx');
      fs.writeFileSync(docxPath, docx);
      const script = `
        process.env.WORKSPACE_BASE = ${JSON.stringify(dir)};
        console.log = () => {};
        console.info = () => {};
        const fs = require('fs');
        const { prepareDeckInfoOnly } = require(${JSON.stringify(path.join(__dirname, 'PrepareDeck.ts'))});
        const CardOption = require(${JSON.stringify(path.join(__dirname, '../../../lib/parser/Settings/index.ts'))}).default;
        const Workspace = require(${JSON.stringify(path.join(__dirname, '../../../lib/parser/WorkSpace.ts'))}).default;
        const contents = fs.readFileSync(${JSON.stringify(docxPath)});
        const started = Date.now();
        prepareDeckInfoOnly(
          {
            name: 'notes.docx',
            settings: new CardOption(CardOption.LoadDefaultOptions()),
            files: [{ name: 'notes.docx', contents }],
            noLimits: false,
            workspace: new Workspace(true, 'fs'),
          },
          new Workspace(true, 'fs'),
          new Workspace(true, 'fs')
        ).then(
          () => process.stdout.write('CONVERTED'),
          (error) => process.stdout.write('REFUSED ' + error.name + ' ' + (Date.now() - started))
        );
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
        { encoding: 'utf8', timeout: 120000 }
      );

      expect(child.signal).toBeNull();
      expect(child.status).toBe(0);
      const refused = /^REFUSED WordDocumentTooLongError (\d+)$/.exec(
        child.stdout
      );
      expect(refused).not.toBeNull();
      expect(Number(refused?.[1])).toBeLessThan(1000);
    },
    150000
  );

  it('tells the visitor to split the file, as a conversion that ran out of memory does', () => {
    const refusal = Object.assign(
      new Error('word_document_too_long: 50000000 bytes of body XML'),
      { name: 'WordDocumentTooLongError' }
    );
    const crash = new ConversionChildCrashedError({
      exitCode: null,
      signal: 'SIGABRT',
      lastRssBytes: null,
      reason: 'conversion_process_crashed',
    });

    expect(jobFailureReasonFromError(refusal, 'job-1')).toBe(
      jobFailureReasonFromError(crash, 'job-1')
    );
    expect(jobFailureReasonFromError(refusal, 'job-1')).toBe(
      'This file is too large to convert in one go. Split it into smaller files and convert each one separately.'
    );
  });
});
