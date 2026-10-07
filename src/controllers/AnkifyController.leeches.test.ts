import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';

import AnkifyController from './AnkifyController';
import { AnkiConnectUnreachableError } from '../services/ankify/AnkiConnectClient';
import { NoteNotOwnedError } from '../usecases/ankify/assertNoteOwned';
import { NoActiveAnkifyClientForLeechError } from '../usecases/ankify/leechClient';

interface CapturingResponse {
  res: Response;
  statusCode: number;
  body: unknown;
  sent: unknown;
}

const makeResponse = (): CapturingResponse => {
  const capture: CapturingResponse = {
    res: {} as Response,
    statusCode: 200,
    body: undefined,
    sent: undefined,
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
    send: vi.fn((payload: unknown) => {
      capture.sent = payload;
      return res;
    }),
  } as unknown as Response;
  capture.res = res;
  return capture;
};

const LIST_INDEX = 28;
const EDIT_INDEX = 29;
const DELETE_INDEX = 30;
const RETURN_INDEX = 31;

const makeController = (index: number, useCase: { execute: Mock }) => {
  const stubs = Array.from({ length: 34 }, () => ({}));
  stubs[index] = useCase;
  return new AnkifyController(
    ...(stubs as ConstructorParameters<typeof AnkifyController>)
  );
};

describe('AnkifyController leech handlers', () => {
  test('listLeeches returns the scoped leech list', async () => {
    const result = {
      connected: true,
      leeches: [
        {
          noteId: 1,
          deckName: 'Notion Sync::Pharmacology',
          modelName: 'Basic',
          fields: [{ name: 'Front', value: 'Q' }],
          tags: ['leech'],
          lapses: 9,
          suspended: true,
        },
      ],
    };
    const execute = vi.fn(async () => result);
    const controller = makeController(LIST_INDEX, { execute });
    const capture = makeResponse();

    await controller.listLeeches({} as Request, capture.res);

    expect(execute).toHaveBeenCalledWith({ owner: 42 });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual(result);
  });

  test('listLeeches returns connected false when offline', async () => {
    const execute = vi.fn(async () => ({ connected: false }));
    const controller = makeController(LIST_INDEX, { execute });
    const capture = makeResponse();

    await controller.listLeeches({} as Request, capture.res);

    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ connected: false });
  });

  test('editLeech 400 when noteId is not an integer', async () => {
    const execute = vi.fn();
    const controller = makeController(EDIT_INDEX, { execute });
    const capture = makeResponse();

    await controller.editLeech(
      {
        params: { noteId: 'abc' },
        body: { fields: { Front: 'x' } },
      } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('editLeech 400 when fields are missing', async () => {
    const execute = vi.fn();
    const controller = makeController(EDIT_INDEX, { execute });
    const capture = makeResponse();

    await controller.editLeech(
      { params: { noteId: '5' }, body: {} } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('editLeech 204 on success and forwards the fields', async () => {
    const execute = vi.fn(async () => undefined);
    const controller = makeController(EDIT_INDEX, { execute });
    const capture = makeResponse();

    await controller.editLeech(
      {
        params: { noteId: '7' },
        body: { fields: { Front: 'Q', Back: 'A' } },
      } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({
      owner: 42,
      noteId: 7,
      fields: { Front: 'Q', Back: 'A' },
    });
    expect(capture.statusCode).toBe(204);
  });

  test('editLeech maps a forged note id to 403 without mutating', async () => {
    const execute = vi.fn(async () => {
      throw new NoteNotOwnedError();
    });
    const controller = makeController(EDIT_INDEX, { execute });
    const capture = makeResponse();

    await controller.editLeech(
      {
        params: { noteId: '999' },
        body: { fields: { Front: 'x' } },
      } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(403);
  });

  test('deleteLeech 400 when noteId is not an integer', async () => {
    const execute = vi.fn();
    const controller = makeController(DELETE_INDEX, { execute });
    const capture = makeResponse();

    await controller.deleteLeech(
      { params: { noteId: '1.5' } } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('deleteLeech 204 on success', async () => {
    const execute = vi.fn(async () => undefined);
    const controller = makeController(DELETE_INDEX, { execute });
    const capture = makeResponse();

    await controller.deleteLeech(
      { params: { noteId: '3' } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({ owner: 42, noteId: 3 });
    expect(capture.statusCode).toBe(204);
  });

  test('deleteLeech maps a forged note id to 403 and never deletes', async () => {
    const execute = vi.fn(async () => {
      throw new NoteNotOwnedError();
    });
    const controller = makeController(DELETE_INDEX, { execute });
    const capture = makeResponse();

    await controller.deleteLeech(
      { params: { noteId: '999' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(403);
  });

  test('deleteLeech maps AnkiConnect unreachable to 503', async () => {
    const execute = vi.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const controller = makeController(DELETE_INDEX, { execute });
    const capture = makeResponse();

    await controller.deleteLeech(
      { params: { noteId: '3' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(503);
  });

  test('returnLeechToReview 200 with the result', async () => {
    const result = { noteId: 4, unsuspended: true, tagRemoved: true as const };
    const execute = vi.fn(async () => result);
    const controller = makeController(RETURN_INDEX, { execute });
    const capture = makeResponse();

    await controller.returnLeechToReview(
      { params: { noteId: '4' } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({ owner: 42, noteId: 4 });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual(result);
  });

  test('returnLeechToReview maps a forged note id to 403', async () => {
    const execute = vi.fn(async () => {
      throw new NoteNotOwnedError();
    });
    const controller = makeController(RETURN_INDEX, { execute });
    const capture = makeResponse();

    await controller.returnLeechToReview(
      { params: { noteId: '999' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(403);
  });

  test('returnLeechToReview maps no active client to 409', async () => {
    const execute = vi.fn(async () => {
      throw new NoActiveAnkifyClientForLeechError();
    });
    const controller = makeController(RETURN_INDEX, { execute });
    const capture = makeResponse();

    await controller.returnLeechToReview(
      { params: { noteId: '4' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(409);
  });
});
