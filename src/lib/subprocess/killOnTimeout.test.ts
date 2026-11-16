import { vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { killOnTimeout } from './killOnTimeout';

function closed(
  child: ChildProcess
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

describe('killOnTimeout', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('kills a tool that runs past the limit and says so in the log', async () => {
    const child = spawn('/bin/sleep', ['30']);
    killOnTimeout(child, 'sleep', 100);

    await expect(closed(child)).resolves.toEqual({
      code: null,
      signal: 'SIGKILL',
    });
    expect(warn).toHaveBeenCalledWith(
      '[subprocess] sleep timed out after 0s, killing it'
    );
  });

  // The sleep inherits the launcher's output pipes, as soffice.bin does: with
  // only the launcher killed, close would wait the full 30 seconds.
  it('kills the children of a launcher so its close event arrives', async () => {
    const launcher = spawn('/bin/sh', ['-c', '/bin/sleep 30 & wait']);
    killOnTimeout(launcher, 'launcher', 300);

    await closed(launcher);

    expect(warn).toHaveBeenCalledWith(
      '[subprocess] launcher timed out after 0s, killing it'
    );
  });

  it('leaves a tool that finishes in time alone', async () => {
    const child = spawn('/bin/sleep', ['0']);
    killOnTimeout(child, 'sleep', 30_000);

    await expect(closed(child)).resolves.toEqual({ code: 0, signal: null });
    expect(warn).not.toHaveBeenCalled();
  });
});
