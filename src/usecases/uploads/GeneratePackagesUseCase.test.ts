jest.mock('../../lib/conversionPool', () => ({
  runUploadGeneration: jest.fn(),
}));

jest.mock('../../lib/parser/WorkSpace');

import GeneratePackagesUseCase from './GeneratePackagesUseCase';
import { runUploadGeneration } from '../../lib/conversionPool';
import CardOption from '../../lib/parser/Settings/CardOption';
import Workspace from '../../lib/parser/WorkSpace';
import { UploadedFile } from '../../lib/storage/types';
import { EmptyDeckError } from '../jobs/EmptyDeckError';
import { UploadFileUnavailableError } from './UploadFileUnavailableError';
import { UploadGenerationTask } from './uploadGenerationTypes';

const mockRunUploadGeneration = runUploadGeneration as jest.MockedFunction<
  typeof runUploadGeneration
>;

function makeSettings(): CardOption {
  return new CardOption({});
}

function makeWorkspace(): Workspace {
  return {} as Workspace;
}

function makeFile(name: string): UploadedFile {
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 0,
    stream: null as never,
    destination: '',
    filename: name,
    path: '',
    buffer: undefined as never,
    key: 'test-key',
  };
}

describe('GeneratePackagesUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches the generation task through the conversion pool', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: true,
      packages: [
        { name: 'notes.apkg', cardCount: 5, mcqCount: 0, mcqSkippedCount: 0 },
      ] as never,
      warnings: [],
    });
    const useCase = new GeneratePackagesUseCase();
    const files = [makeFile('notes.html')];
    const settings = makeSettings();
    const workspace = makeWorkspace();

    const result = await useCase.execute(false, files, settings, workspace);

    expect(mockRunUploadGeneration).toHaveBeenCalledTimes(1);
    const [task] = mockRunUploadGeneration.mock.calls[0];
    expect(task).toMatchObject({
      paying: false,
      files,
      settings,
      workspace,
      userId: null,
    });
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('notes.apkg');
    expect(result.warnings).toEqual([]);
  });

  it('passes paying and userId through to the pool task', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: true,
      packages: [],
      warnings: [],
    });
    const useCase = new GeneratePackagesUseCase();

    await useCase.execute(
      true,
      [makeFile('notes.html')],
      makeSettings(),
      makeWorkspace(),
      undefined,
      42,
      undefined,
      'req-0f1e2d3c'
    );

    const [task] = mockRunUploadGeneration.mock.calls[0];
    expect(task).toMatchObject({
      paying: true,
      userId: 42,
      requestId: 'req-0f1e2d3c',
    });
  });

  it('forwards progress messages from the pool worker to onProgress', async () => {
    let progressDelivered: () => void = () => undefined;
    const delivered = new Promise<void>((resolve) => {
      progressDelivered = resolve;
    });
    const onProgress = jest.fn(() => progressDelivered());
    mockRunUploadGeneration.mockImplementationOnce(
      async (task: UploadGenerationTask) => {
        task.progressPort?.postMessage('Parsing notes.html');
        await delivered;
        return { ok: true, packages: [], warnings: [] };
      }
    );
    const useCase = new GeneratePackagesUseCase();

    await useCase.execute(
      false,
      [makeFile('notes.html')],
      makeSettings(),
      makeWorkspace(),
      onProgress
    );

    expect(onProgress).toHaveBeenCalledWith('Parsing notes.html');
    const [task, transferList] = mockRunUploadGeneration.mock.calls[0];
    expect(transferList).toEqual([task.progressPort]);
  });

  it('omits the progress channel when no onProgress callback is given', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: true,
      packages: [],
      warnings: [],
    });
    const useCase = new GeneratePackagesUseCase();

    await useCase.execute(
      false,
      [makeFile('notes.html')],
      makeSettings(),
      makeWorkspace()
    );

    const [task, transferList] = mockRunUploadGeneration.mock.calls[0];
    expect(task.progressPort).toBeUndefined();
    expect(transferList).toBeUndefined();
  });

  it('rejects when the pool worker reports an error', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: false,
      error: {
        message: "Cannot read properties of undefined (reading 'name')",
      },
    });
    const useCase = new GeneratePackagesUseCase();

    await expect(
      useCase.execute(
        false,
        [makeFile('bad.html')],
        makeSettings(),
        makeWorkspace()
      )
    ).rejects.toThrow("Cannot read properties of undefined (reading 'name')");
  });

  it('rejects when the pool run itself fails', async () => {
    mockRunUploadGeneration.mockRejectedValueOnce(new Error('Worker crashed'));
    const useCase = new GeneratePackagesUseCase();

    await expect(
      useCase.execute(
        false,
        [makeFile('crash.html')],
        makeSettings(),
        makeWorkspace()
      )
    ).rejects.toThrow('Worker crashed');
  });

  it('rejects with EmptyDeckError when the worker error is named EmptyDeckError', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: false,
      error: {
        message:
          'No cards found in your upload. Use .zip, .html, .md, or .csv.',
        name: 'EmptyDeckError',
      },
    });
    const useCase = new GeneratePackagesUseCase();

    await expect(
      useCase.execute(
        false,
        [makeFile('empty.html')],
        makeSettings(),
        makeWorkspace()
      )
    ).rejects.toBeInstanceOf(EmptyDeckError);
  });

  it('rejects with a non-empty parser-crash error when the worker error has no message', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({ ok: false, error: {} });
    const useCase = new GeneratePackagesUseCase();

    const err = await useCase
      .execute(
        false,
        [makeFile('garbled.html')],
        makeSettings(),
        makeWorkspace()
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message.trim()).not.toBe('');
    expect((err as Error & { code?: string }).code).toBe('PARSER_CRASH');
  });

  it('rejects with a non-empty parser-crash error when the worker error message is blank', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: false,
      error: { message: '  ' },
    });
    const useCase = new GeneratePackagesUseCase();

    const err = await useCase
      .execute(
        false,
        [makeFile('garbled.html')],
        makeSettings(),
        makeWorkspace()
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message.trim()).not.toBe('');
    expect((err as Error & { code?: string }).code).toBe('PARSER_CRASH');
  });

  it('preserves the markdown sourceFormat on EmptyDeckError across the pool boundary', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: false,
      error: {
        message:
          'No cards found in your upload. Use .zip, .html, .md, or .csv.',
        name: 'EmptyDeckError',
        sourceFormat: 'markdown',
      },
    });
    const useCase = new GeneratePackagesUseCase();

    const err = await useCase
      .execute(
        false,
        [makeFile('flat-export.md')],
        makeSettings(),
        makeWorkspace()
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EmptyDeckError);
    expect((err as EmptyDeckError).sourceFormat).toBe('markdown');
  });

  it('rejects with UploadFileUnavailableError when an upload temp file is gone and has no buffer', async () => {
    const useCase = new GeneratePackagesUseCase();
    const file = makeFile('lecture.zip');
    file.path = '/media/storage/uploads/does-not-exist-1234567890';
    file.buffer = undefined as never;

    const err = await useCase
      .execute(false, [file], makeSettings(), makeWorkspace())
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UploadFileUnavailableError);
    expect((err as UploadFileUnavailableError).filename).toBe('lecture.zip');
  });

  it('does not dispatch the conversion pool when an upload temp file is unavailable', async () => {
    const useCase = new GeneratePackagesUseCase();
    const file = makeFile('lecture.zip');
    file.path = '/media/storage/uploads/does-not-exist-1234567890';
    file.buffer = undefined as never;

    await useCase
      .execute(false, [file], makeSettings(), makeWorkspace())
      .catch(() => undefined);

    expect(mockRunUploadGeneration).not.toHaveBeenCalled();
  });

  it('still dispatches when the temp file is gone but a buffer fallback was captured', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: true,
      packages: [],
      warnings: [],
    });
    const useCase = new GeneratePackagesUseCase();
    const file = makeFile('lecture.zip');
    file.path = '/media/storage/uploads/does-not-exist-1234567890';
    file.buffer = Buffer.from('fallback bytes');

    await useCase.execute(false, [file], makeSettings(), makeWorkspace());

    expect(mockRunUploadGeneration).toHaveBeenCalledTimes(1);
  });

  it('preserves error name on the rejected Error for non-EmptyDeckError named errors', async () => {
    mockRunUploadGeneration.mockResolvedValueOnce({
      ok: false,
      error: { message: 'some message', name: 'CustomError' },
    });
    const useCase = new GeneratePackagesUseCase();

    const err = await useCase
      .execute(false, [makeFile('other.html')], makeSettings(), makeWorkspace())
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('CustomError');
  });
});
