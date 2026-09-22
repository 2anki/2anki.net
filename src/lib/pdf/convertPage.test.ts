import { EventEmitter } from 'events';
import { spawn as realSpawn, type ChildProcess } from 'child_process';
import { convertPage } from './convertPage';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return { ...actual, spawn: jest.fn(actual.spawn) };
});

const spawnMock = realSpawn as jest.MockedFunction<typeof realSpawn>;

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
