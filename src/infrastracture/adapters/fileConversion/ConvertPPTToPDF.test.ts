import { EventEmitter } from 'node:events';
import * as childProcess from 'node:child_process';
import { convertPPTToPDF } from './ConvertPPTToPDF';
import Workspace from '../../../lib/parser/WorkSpace';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}));

const mockedSpawn = childProcess.spawn as jest.MockedFunction<
  typeof childProcess.spawn
>;

function makeProcess(
  stderr: string,
  exitCode: number
): childProcess.ChildProcess {
  const proc = new EventEmitter() as childProcess.ChildProcess;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout =
    stdoutEmitter;
  (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr =
    stderrEmitter;

  setImmediate(() => {
    if (stderr) {
      stderrEmitter.emit('data', Buffer.from(stderr));
    }
    proc.emit('close', exitCode);
  });

  return proc;
}

const makeFailingProcess = makeProcess;

function spawnedArgs(callIndex: number): string[] {
  return mockedSpawn.mock.calls[callIndex][1] as string[];
}

describe('convertPPTToPDF', () => {
  const workspace = { location: '/tmp/test-ws' } as Workspace;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('surfaces the subprocess stderr and exit code on failure', async () => {
    const stderr = 'unoconv: Cannot connect to a running LibreOffice instance.';
    mockedSpawn.mockReturnValue(makeFailingProcess(stderr, 251));

    const result = await convertPPTToPDF(
      'slides.pptx',
      Buffer.from('fake'),
      workspace
    ).then(
      () => ({ rejected: false, message: '' }),
      (err: Error) => ({ rejected: true, message: err.message })
    );

    expect(result.rejected).toBe(true);
    expect(result.message).toContain('251');
    expect(result.message).toContain(stderr);
  });

  it('logs the subprocess stderr to the server console on failure', async () => {
    const stderr = 'unoconv: Document export failed.';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedSpawn.mockReturnValue(makeFailingProcess(stderr, 251));

    await convertPPTToPDF('slides.pptx', Buffer.from('fake'), workspace).catch(
      () => undefined
    );

    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain(stderr);
    expect(logged).toContain('251');

    errorSpy.mockRestore();
  });

  it('converts headlessly with an isolated profile per invocation', async () => {
    mockedSpawn.mockReturnValue(makeProcess('', 0));

    const result = await convertPPTToPDF(
      'slides.pptx',
      Buffer.from('fake'),
      workspace
    );

    expect(result).toEqual(Buffer.from('pdf-bytes'));
    const [bin] = mockedSpawn.mock.calls[0];
    expect(String(bin)).toContain('soffice');
    const args = spawnedArgs(0);
    expect(args).toEqual(
      expect.arrayContaining(['--headless', '--convert-to', 'pdf', '--outdir'])
    );
    expect(args.some((a) => a.startsWith('-env:UserInstallation=file:'))).toBe(
      true
    );
  });

  it('uses a different profile directory on every invocation', async () => {
    mockedSpawn.mockReturnValueOnce(makeProcess('', 0));
    mockedSpawn.mockReturnValueOnce(makeProcess('', 0));

    await convertPPTToPDF('a.pptx', Buffer.from('fake'), workspace);
    await convertPPTToPDF('b.pptx', Buffer.from('fake'), workspace);

    const profileOf = (args: string[]) =>
      args.find((a) => a.startsWith('-env:UserInstallation='));
    const first = profileOf(spawnedArgs(0));
    const second = profileOf(spawnedArgs(1));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toEqual(second);
  });

  it('rejects instead of hanging when exit 0 produced no PDF', async () => {
    const fsPromises = jest.requireMock('fs/promises') as {
      readFile: jest.Mock;
    };
    fsPromises.readFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );
    mockedSpawn.mockReturnValue(makeProcess('', 0));

    await expect(
      convertPPTToPDF('slides.pptx', Buffer.from('fake'), workspace)
    ).rejects.toThrow(/no PDF/i);
  });
});
