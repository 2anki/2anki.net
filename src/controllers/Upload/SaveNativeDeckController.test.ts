import { vi, type Mocked } from 'vitest';
import express from 'express';

import { SaveNativeDeckController } from './SaveNativeDeckController';
import { SaveNativeDeckUseCase } from '../../usecases/uploads/SaveNativeDeckUseCase';

function makeResponse(locals: Record<string, unknown>) {
  const res = {
    locals,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as express.Response & {
    statusCode: number;
    body: unknown;
  };
}

function makeRequest(
  file: Partial<Express.Multer.File> | undefined,
  body: Record<string, unknown>
) {
  return { file, body } as unknown as express.Request;
}

function makeUseCase() {
  return {
    execute: vi.fn(),
  } as unknown as Mocked<SaveNativeDeckUseCase>;
}

const apkgFile: Partial<Express.Multer.File> = {
  originalname: 'Pharmacology.apkg',
  buffer: Buffer.from('apkg-bytes'),
  size: 2 * 1024 * 1024,
};

describe('SaveNativeDeckController', () => {
  it('saves the deck and returns the typed key, filename, size_mb shape', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue({
      key: 'app-1-deck.apkg',
      filename: 'Pharmacology.apkg',
      size_mb: 2,
    });
    const controller = new SaveNativeDeckController(useCase);
    const res = makeResponse({ owner: 42, subscriber: true });

    await controller.save(
      makeRequest(apkgFile, { name: 'Pharmacology', dedupe_key: 'hash-abc' }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      key: 'app-1-deck.apkg',
      filename: 'Pharmacology.apkg',
      size_mb: 2,
    });
  });

  it('takes owner from res.locals and never from the request body', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue({
      key: 'app-1-deck.apkg',
      filename: 'Pharmacology.apkg',
      size_mb: 2,
    });
    const controller = new SaveNativeDeckController(useCase);
    const res = makeResponse({ owner: 42, subscriber: true });

    await controller.save(
      makeRequest(apkgFile, { owner: 999, name: 'Pharmacology' }),
      res
    );

    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 42 })
    );
  });

  it('returns 400 when no file is attached', async () => {
    const useCase = makeUseCase();
    const controller = new SaveNativeDeckController(useCase);
    const res = makeResponse({ owner: 42, subscriber: true });

    await controller.save(makeRequest(undefined, {}), res);

    expect(res.statusCode).toBe(400);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('rejects a non-apkg file server-side', async () => {
    const useCase = makeUseCase();
    const controller = new SaveNativeDeckController(useCase);
    const res = makeResponse({ owner: 42, subscriber: true });

    await controller.save(
      makeRequest({ ...apkgFile, originalname: 'notes.zip' }, {}),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('falls back to the original filename when no name is supplied', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockResolvedValue({
      key: 'app-1-deck.apkg',
      filename: 'Pharmacology.apkg',
      size_mb: 2,
    });
    const controller = new SaveNativeDeckController(useCase);
    const res = makeResponse({ owner: 42, subscriber: true });

    await controller.save(makeRequest(apkgFile, {}), res);

    expect(useCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Pharmacology.apkg',
        dedupeKey: null,
      })
    );
  });
});
