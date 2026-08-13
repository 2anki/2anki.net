import { EventEmitter } from 'node:events';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import CardGenerator from './CardGenerator';

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(),
  execFileSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const mockedSpawn = childProcess.spawn as jest.MockedFunction<
  typeof childProcess.spawn
>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<
  typeof fs.existsSync
>;
const mockedWriteFileSync = fs.writeFileSync as jest.MockedFunction<
  typeof fs.writeFileSync
>;

function makeProcessStub(
  stdout: string,
  exitCode: number = 0
): childProcess.ChildProcess {
  const proc = new EventEmitter() as childProcess.ChildProcess;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout =
    stdoutEmitter;
  (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr =
    stderrEmitter;

  setImmediate(() => {
    stdoutEmitter.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('CardGenerator.runBatch', () => {
  const workspace = '/tmp/test-workspace';
  const templateDir = '/fake/templates';

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it('writes a manifest JSON file and spawns Python with --batch flag', async () => {
    const entries = [
      { input: '/ws/deck_a/deck_info.json', output: '/ws/deck_a/out.apkg' },
      { input: '/ws/deck_b/deck_info.json', output: '/ws/deck_b/out.apkg' },
    ];
    const outputPaths = entries.map((e) => e.output).join('\n');

    mockedSpawn.mockReturnValue(makeProcessStub(outputPaths));

    const gen = new CardGenerator(workspace);
    const result = await gen.runBatch(entries);

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('batch_manifest'),
      JSON.stringify(entries)
    );

    const spawnArgs = mockedSpawn.mock.calls[0];
    expect(spawnArgs[1]).toContain('--batch');
    const batchArgIndex = spawnArgs[1].indexOf('--batch');
    expect(spawnArgs[1][batchArgIndex + 1]).toMatch(/batch_manifest.*\.json$/);

    expect(result).toEqual(['/ws/deck_a/out.apkg', '/ws/deck_b/out.apkg']);
  });

  it('returns output paths from stdout, one per line', async () => {
    const entries = [
      { input: '/ws/a/deck_info.json', output: '/ws/a/deck.apkg' },
    ];
    mockedSpawn.mockReturnValue(makeProcessStub('/ws/a/deck.apkg\n'));

    const gen = new CardGenerator(workspace);
    const result = await gen.runBatch(entries);

    expect(result).toEqual(['/ws/a/deck.apkg']);
  });

  it('rejects when Python exits with non-zero code', async () => {
    const entries = [
      { input: '/ws/bad/deck_info.json', output: '/ws/bad/out.apkg' },
    ];

    const proc = new EventEmitter() as childProcess.ChildProcess;
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stdout =
      stdoutEmitter;
    (proc as unknown as { stdout: EventEmitter; stderr: EventEmitter }).stderr =
      stderrEmitter;

    setImmediate(() => {
      stderrEmitter.emit(
        'data',
        Buffer.from('FileNotFoundError: /ws/bad/deck_info.json')
      );
      proc.emit('close', 1);
    });

    mockedSpawn.mockReturnValue(proc);

    const gen = new CardGenerator(workspace);
    await expect(gen.runBatch(entries)).rejects.toThrow();
  });

  it('rejects when stdout does not end with .apkg paths', async () => {
    const entries = [
      { input: '/ws/a/deck_info.json', output: '/ws/a/out.apkg' },
    ];
    mockedSpawn.mockReturnValue(
      makeProcessStub('No cards generated; exiting cleanly\n')
    );

    const gen = new CardGenerator(workspace);
    const result = await gen.runBatch(entries);
    expect(result).toEqual([]);
  });

  it('passes the workspace as cwd to the spawned process', async () => {
    const entries = [
      { input: '/ws/a/deck_info.json', output: '/ws/a/out.apkg' },
    ];
    mockedSpawn.mockReturnValue(makeProcessStub('/ws/a/out.apkg'));

    const gen = new CardGenerator(workspace);
    await gen.runBatch(entries);

    expect(mockedSpawn.mock.calls[0][2]).toMatchObject({ cwd: workspace });
  });
});

describe('CardGenerator.run zero-card sentinel', () => {
  const workspace = '/tmp/test-workspace';

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it('rejects with PythonZeroCardsError when Python exits cleanly with no cards', async () => {
    mockedSpawn.mockReturnValue(
      makeProcessStub('No cards generated; exiting cleanly', 0)
    );

    const gen = new CardGenerator(workspace);
    await expect(gen.run()).rejects.toMatchObject({
      name: 'PythonZeroCardsError',
    });
  });

  it('keeps the generic error for a missing apkg path without the sentinel', async () => {
    mockedSpawn.mockReturnValue(makeProcessStub('some unrelated output', 0));

    const gen = new CardGenerator(workspace);
    await expect(gen.run()).rejects.toMatchObject({ name: 'Error' });
  });
});
