import { vi } from 'vitest';
import { Request, Response } from 'express';

import AnkifyController from './AnkifyController';
import {
  ConflictNotFoundForOpenError,
  OpenConflictInAnkiUseCase,
} from '../usecases/ankify/OpenConflictInAnkiUseCase';

interface CapturingResponse {
  res: Response;
  statusCode: number;
  body: unknown;
}

const makeResponse = (): CapturingResponse => {
  const capture: CapturingResponse = {
    res: {} as Response,
    statusCode: 200,
    body: undefined,
  };
  const res = {
    locals: { owner: 42 },
    status: vi.fn((code: number) => {
      capture.statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      capture.body = payload;
      return res;
    }),
  } as unknown as Response;
  capture.res = res;
  return capture;
};

const makeController = (openUseCase: OpenConflictInAnkiUseCase) => {
  const stubs = Array.from({ length: 30 }, () => ({}));
  stubs[16] = openUseCase;
  return new AnkifyController(
    ...(stubs as ConstructorParameters<typeof AnkifyController>)
  );
};

describe('AnkifyController.openConflictInAnki', () => {
  test('200 with opened true for a valid owned conflict', async () => {
    const execute = vi.fn(async () => ({ opened: true }));
    const controller = makeController({
      execute,
    } as unknown as OpenConflictInAnkiUseCase);
    const capture = makeResponse();

    await controller.openConflictInAnki(
      { params: { id: '7' } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({ id: 7, owner: 42 });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ opened: true });
  });

  test('200 with opened false when the client is offline', async () => {
    const execute = vi.fn(async () => ({ opened: false }));
    const controller = makeController({
      execute,
    } as unknown as OpenConflictInAnkiUseCase);
    const capture = makeResponse();

    await controller.openConflictInAnki(
      { params: { id: '7' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ opened: false });
  });

  test('400 for a non-integer id without invoking the use case', async () => {
    const execute = vi.fn();
    const controller = makeController({
      execute,
    } as unknown as OpenConflictInAnkiUseCase);
    const capture = makeResponse();

    await controller.openConflictInAnki(
      { params: { id: 'nope' } } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('404 when the conflict is not owned by the requester', async () => {
    const execute = vi.fn(async () => {
      throw new ConflictNotFoundForOpenError();
    });
    const controller = makeController({
      execute,
    } as unknown as OpenConflictInAnkiUseCase);
    const capture = makeResponse();

    await controller.openConflictInAnki(
      { params: { id: '99' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(404);
  });
});
