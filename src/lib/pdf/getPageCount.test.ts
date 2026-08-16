import { EventEmitter } from 'events';
import { execSync, spawn as realSpawn, type ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getPageCount } from './getPageCount';
import { jobFailureReasonCode } from '../../usecases/jobs/jobFailureReason';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return { ...actual, spawn: jest.fn(actual.spawn) };
});

const spawnMock = realSpawn as jest.MockedFunction<typeof realSpawn>;

const hasPdfinfo = (() => {
  try {
    execSync('pdfinfo -v 2>&1', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

const itIfPdfinfo = hasPdfinfo ? it : it.skip;

interface FakePdfinfoRun {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
}

function fakePdfinfo(run: FakePdfinfoRun) {
  spawnMock.mockImplementationOnce((): ChildProcess => {
    const proc = new EventEmitter() as ChildProcess;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter }).stdout = stdout;
    (proc as unknown as { stderr: EventEmitter }).stderr = stderr;

    setImmediate(() => {
      if (run.stdout != null) {
        stdout.emit('data', Buffer.from(run.stdout));
      }
      if (run.stderr != null) {
        stderr.emit('data', Buffer.from(run.stderr));
      }
      proc.emit('close', run.code ?? 0, run.signal ?? null);
    });

    return proc;
  });
}

describe('getPageCount', () => {
  let tmpDir: string;
  let pdfPath: string;

  beforeEach(async () => {
    spawnMock.mockClear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'getPageCount-test-'));
    pdfPath = path.join(tmpDir, 'sample.pdf');
    await fs.writeFile(pdfPath, '%PDF-1.4 placeholder');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  itIfPdfinfo(
    'rejects with pdfinfo_failed message when given a non-PDF file',
    async () => {
      const textFile = path.join(tmpDir, 'not-a-pdf.txt');
      await fs.writeFile(textFile, 'this is plain text, not a PDF');

      await expect(getPageCount(textFile)).rejects.toMatchObject({
        message: expect.stringMatching(/^pdfinfo_failed code=/),
      });
    }
  );

  itIfPdfinfo(
    'rejects with pdfinfo_failed message containing stderr text when given a non-PDF file',
    async () => {
      const textFile = path.join(tmpDir, 'not-a-pdf.txt');
      await fs.writeFile(textFile, 'this is plain text, not a PDF');

      let caught: Error | null = null;
      try {
        await getPageCount(textFile);
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toMatch(/^pdfinfo_failed code=/);
      expect(caught!.message).toContain('path=not-a-pdf.txt');
    }
  );

  it('still resolves when the pdf filename is too long for a diagnostic log name', async () => {
    const longBase = 'a'.repeat(250);
    const longPath = path.join(tmpDir, `${longBase}.pdf`);
    await fs.writeFile(longPath, '%PDF-1.4 placeholder');
    fakePdfinfo({ stdout: 'Pages: 3\n', code: 0 });

    await expect(getPageCount(longPath)).resolves.toBe(3);
  }, 10000);

  it('rejects encrypted PDFs with a message the failure classifier reads as pdf_password', async () => {
    fakePdfinfo({
      stderr: 'Command Line Error: Incorrect password\nEncrypted',
      code: 1,
    });

    let caught: unknown = null;
    try {
      await getPageCount(pdfPath);
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    expect(jobFailureReasonCode(caught)).toBe('pdf_password');
  });

  it('rejects zero-page PDFs with a message the failure classifier reads as pdf_unreadable', async () => {
    fakePdfinfo({
      stdout: 'Title:          Broken\nPages:          0\n',
      code: 0,
    });

    let caught: unknown = null;
    try {
      await getPageCount(pdfPath);
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    expect(jobFailureReasonCode(caught)).toBe('pdf_unreadable');
  });
});
