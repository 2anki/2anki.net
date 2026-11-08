import { vi, type MockedFunction } from 'vitest';
import { EventEmitter } from 'events';
import { spawn as realSpawn, type ChildProcess } from 'child_process';
import { convertPage } from './convertPage';

vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const spawnMock = realSpawn as MockedFunction<typeof realSpawn>;

function fakePdftoppm(code: number | null, signal: NodeJS.Signals | null) {
  spawnMock.mockImplementationOnce((): ChildProcess => {
    const proc = new EventEmitter() as ChildProcess;
    setImmediate(() => {
      proc.emit('close', code, signal);
    });
    return proc;
  });
}

describe('convertPage', () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it.each(['SIGKILL', 'SIGTERM'] as const)(
    'surfaces the %s kill signal in the rejection message',
    async (signal) => {
      fakePdftoppm(null, signal);

      let caught: Error | null = null;
      try {
        await convertPage('/tmp/sample.pdf', 1, 1);
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain(`signal=${signal}`);
      expect(caught!.message).toContain('code=null');
    }
  );

  it('opens a locked PDF with either of its passwords', async () => {
    fakePdftoppm(0, null);

    await convertPage('/tmp/sample.pdf', 2, 3, 's3cret');

    expect(spawnMock.mock.calls[0][1]).toEqual([
      '-png',
      '-f',
      '2',
      '-l',
      '2',
      '-opw',
      's3cret',
      '-upw',
      's3cret',
      '/tmp/sample.pdf',
      '/tmp/sample.pdf-page2',
    ]);
  });

  it('sends no password option for an unlocked PDF', async () => {
    fakePdftoppm(0, null);

    await convertPage('/tmp/sample.pdf', 1, 1);

    expect(spawnMock.mock.calls[0][1]).not.toContain('-upw');
    expect(spawnMock.mock.calls[0][1]).not.toContain('-opw');
  });

  it('surfaces a non-zero exit code with no signal', async () => {
    fakePdftoppm(1, null);

    let caught: Error | null = null;
    try {
      await convertPage('/tmp/sample.pdf', 1, 1);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('code=1');
    expect(caught!.message).toContain('signal=none');
  });

  it('resolves to the page image path on a clean exit', async () => {
    fakePdftoppm(0, null);

    await expect(convertPage('/tmp/sample.pdf', 1, 1)).resolves.toBe(
      '/tmp/sample.pdf-page1-1.png'
    );
  });
});
