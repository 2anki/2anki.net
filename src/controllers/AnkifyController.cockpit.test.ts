import { Request, Response } from 'express';

import AnkifyController from './AnkifyController';
import {
  AnkiConnectUnreachableError,
  AnkiFullSyncRequiredError,
} from '../services/ankify/AnkiConnectClient';
import { NoActiveAnkifyClientForProfileError } from '../usecases/ankify/GetAnkifyActiveProfileUseCase';
import { NoActiveAnkifyClientForSyncError } from '../usecases/ankify/SyncToAnkiWebUseCase';
import { DeckNotOwnedError } from '../usecases/ankify/OpenDeckInAnkiUseCase';

interface CapturingResponse {
  res: Response;
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sent: unknown;
}

const makeResponse = (): CapturingResponse => {
  const capture: CapturingResponse = {
    res: {} as Response,
    statusCode: 200,
    body: undefined,
    headers: {},
    sent: undefined,
  };
  const res = {
    locals: { owner: 42 },
    status: jest.fn((code: number) => {
      capture.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: unknown) => {
      capture.body = payload;
      return res;
    }),
    setHeader: jest.fn((name: string, value: string) => {
      capture.headers[name] = value;
      return res;
    }),
    send: jest.fn((payload: unknown) => {
      capture.sent = payload;
      return res;
    }),
  } as unknown as Response;
  capture.res = res;
  return capture;
};

const PROFILE_INDEX = 24;
const SYNC_INDEX = 25;
const OPEN_DECK_INDEX = 26;
const MATURITY_INDEX = 27;

const makeController = (index: number, useCase: { execute: jest.Mock }) => {
  const stubs = Array.from({ length: 28 }, () => ({}));
  stubs[index] = useCase;
  return new AnkifyController(
    ...(stubs as ConstructorParameters<typeof AnkifyController>)
  );
};

describe('AnkifyController cockpit handlers', () => {
  test('getActiveProfile returns the profile name', async () => {
    const execute = jest.fn(async () => ({ profile: 'User 1' }));
    const controller = makeController(PROFILE_INDEX, { execute });
    const capture = makeResponse();

    await controller.getActiveProfile({} as Request, capture.res);

    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ profile: 'User 1' });
  });

  test('getActiveProfile maps no active client to 409', async () => {
    const execute = jest.fn(async () => {
      throw new NoActiveAnkifyClientForProfileError();
    });
    const controller = makeController(PROFILE_INDEX, { execute });
    const capture = makeResponse();

    await controller.getActiveProfile({} as Request, capture.res);

    expect(capture.statusCode).toBe(409);
  });

  test('getActiveProfile maps AnkiConnect unreachable to 503', async () => {
    const execute = jest.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const controller = makeController(PROFILE_INDEX, { execute });
    const capture = makeResponse();

    await controller.getActiveProfile({} as Request, capture.res);

    expect(capture.statusCode).toBe(503);
  });

  test('syncToAnkiWeb returns ok true', async () => {
    const execute = jest.fn(async () => undefined);
    const controller = makeController(SYNC_INDEX, { execute });
    const capture = makeResponse();

    await controller.syncToAnkiWeb({} as Request, capture.res);

    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ ok: true });
  });

  test('syncToAnkiWeb maps no active client to 409', async () => {
    const execute = jest.fn(async () => {
      throw new NoActiveAnkifyClientForSyncError();
    });
    const controller = makeController(SYNC_INDEX, { execute });
    const capture = makeResponse();

    await controller.syncToAnkiWeb({} as Request, capture.res);

    expect(capture.statusCode).toBe(409);
  });

  test('syncToAnkiWeb maps a required full sync to a calm 409, not a raw error', async () => {
    const execute = jest.fn(async () => {
      throw new AnkiFullSyncRequiredError(
        'Sync status 2 not one of [0, 1] - see SyncCollectionResponse.ChangesRequired for list of sync statuses: https://github.com/ankitects/anki/blob/e41c4573d789afe8b020fab5d9d1eede50c3fa3d/proto/anki/sync.proto#L57-L65'
      );
    });
    const controller = makeController(SYNC_INDEX, { execute });
    const capture = makeResponse();

    await controller.syncToAnkiWeb({} as Request, capture.res);

    expect(capture.statusCode).toBe(409);
    expect(capture.body).toEqual({
      message:
        'Anki wants to fully resync this collection. Open Anki desktop, resolve the sync prompt there, then try again.',
    });
  });

  test('openDeckInAnki 400 when deck is missing', async () => {
    const execute = jest.fn();
    const controller = makeController(OPEN_DECK_INDEX, { execute });
    const capture = makeResponse();

    await controller.openDeckInAnki(
      { body: {} } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('openDeckInAnki returns opened for an owned deck', async () => {
    const execute = jest.fn(async () => ({ opened: true }));
    const controller = makeController(OPEN_DECK_INDEX, { execute });
    const capture = makeResponse();

    await controller.openDeckInAnki(
      { body: { deck: 'MS3::Pharma' } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({ owner: 42, deck: 'MS3::Pharma' });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ opened: true });
  });

  test('openDeckInAnki maps a not-owned deck to 403', async () => {
    const execute = jest.fn(async () => {
      throw new DeckNotOwnedError();
    });
    const controller = makeController(OPEN_DECK_INDEX, { execute });
    const capture = makeResponse();

    await controller.openDeckInAnki(
      { body: { deck: 'Default' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(403);
  });

  test('getDeckMaturity 400 when deck query is missing', async () => {
    const execute = jest.fn();
    const controller = makeController(MATURITY_INDEX, { execute });
    const capture = makeResponse();

    await controller.getDeckMaturity(
      { query: {} } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('getDeckMaturity returns the maturity payload', async () => {
    const execute = jest.fn(async () => ({
      connected: true,
      matureCount: 2,
      total: 4,
      avgIntervalDays: 19,
    }));
    const controller = makeController(MATURITY_INDEX, { execute });
    const capture = makeResponse();

    await controller.getDeckMaturity(
      { query: { deck: 'MS3::Pharma' } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({ owner: 42, deck: 'MS3::Pharma' });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toMatchObject({ matureCount: 2, total: 4 });
  });
});
