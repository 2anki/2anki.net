import { vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { killOnTimeout, killTreeOnTimeout } from './killOnTimeout';

interface Closed {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function closed(child: ChildProcess): Promise<Closed> {
  return new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

function isAlive(pid: number): boolean {
  return spawnSync('kill', ['-0', String(pid)]).status === 0;
}

// Each launcher prints the pid of the sleep it starts, then behaves as named.
const LAUNCHER_THAT_WAITS = '/bin/sleep 20 & echo $!; wait';
const LAUNCHER_THAT_EXITS = '/bin/sleep 20 & echo $!; exit 0';

function firstLine(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.stdout?.once('data', (chunk: Buffer) =>
      resolve(Number(chunk.toString().trim()))
    );
  });
}

describe('tool timeouts', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('kills a tool that runs past the limit and names it in the log', async () => {
    const child = spawn('/bin/sleep', ['20']);
    killOnTimeout(child, 'sleep', 1000);

    await expect(closed(child)).resolves.toEqual({
      code: null,
      signal: 'SIGKILL',
    });
    expect(warn).toHaveBeenCalledWith(
      `[subprocess] sleep pid=${child.pid} timed out after 1s, killing it`
    );
  });

  it('leaves a tool that finishes in time alone', async () => {
    const child = spawn('/bin/sleep', ['0']);
    killOnTimeout(child, 'sleep', 30_000);

    await expect(closed(child)).resolves.toEqual({ code: 0, signal: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it('kills the process a launcher started, not only the launcher', async () => {
    const launcher = spawn('/bin/sh', ['-c', LAUNCHER_THAT_WAITS]);
    const sleepPid = await firstLine(launcher);
    killTreeOnTimeout(launcher, 'launcher', 300);

    await closed(launcher);

    expect(isAlive(sleepPid)).toBe(false);
  });

  // The sleep outlives the launcher and holds its output pipe, so without the
  // pipes being closed the close event would wait the full 20 seconds.
  it('lets close arrive when the tool has exited but a process it started holds the pipes', async () => {
    const launcher = spawn('/bin/sh', ['-c', LAUNCHER_THAT_EXITS]);
    const sleepPid = await firstLine(launcher);
    killTreeOnTimeout(launcher, 'launcher', 300);

    await expect(closed(launcher)).resolves.toEqual({ code: 0, signal: null });

    process.kill(sleepPid, 'SIGKILL');
  });
});
