import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';

import AnkifyController from './AnkifyController';
import { AnkiConnectUnreachableError } from '../services/ankify/AnkiConnectClient';
import {
  InvalidReviewEaseError,
  NoActiveAnkifyClientForReviewError,
  ReviewCardNotFoundError,
} from '../usecases/ankify/GradeReviewCardUseCase';

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
    send: vi.fn(() => res),
  } as unknown as Response;
  capture.res = res;
  return capture;
};

const QUEUE_INDEX = 32;
const CARD_INDEX = 33;
const GRADE_INDEX = 34;

const makeController = (index: number, useCase: { execute: Mock }) => {
  const stubs = Array.from({ length: 35 }, () => ({}));
  stubs[index] = useCase;
  return new AnkifyController(
    ...(stubs as ConstructorParameters<typeof AnkifyController>)
  );
};

describe('AnkifyController review handlers', () => {
  test('getReviewQueue returns the due card ids for an owned deck', async () => {
    const result = { connected: true, cardIds: [9001, 9002] };
    const execute = vi.fn(async () => result);
    const controller = makeController(QUEUE_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewQueue(
      { query: { deck: 'Notion Sync::Pharma' } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({
      owner: 42,
      deck: 'Notion Sync::Pharma',
    });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual(result);
  });

  test('getReviewQueue rejects a missing deck with 400', async () => {
    const execute = vi.fn();
    const controller = makeController(QUEUE_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewQueue(
      { query: {} } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('getReviewQueue maps AnkiConnectUnreachableError to 503', async () => {
    const execute = vi.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const controller = makeController(QUEUE_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewQueue(
      { query: { deck: 'Other::Deck' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(503);
  });

  test('getReviewCard returns the rendered card for a valid cardId', async () => {
    const card = {
      cardId: 9001,
      questionHtml: '<p>Q</p>',
      answerHtml: '<p>A</p>',
      css: '.card{}',
    };
    const execute = vi.fn(async () => ({ connected: true, card }));
    const controller = makeController(CARD_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewCard(
      { query: { cardId: '9001' } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({ owner: 42, cardId: 9001 });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ connected: true, card });
  });

  test('getReviewCard returns card:null when the card is gone', async () => {
    const execute = vi.fn(async () => ({ connected: true, card: null }));
    const controller = makeController(CARD_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewCard(
      { query: { cardId: '9001' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ connected: true, card: null });
  });

  test('getReviewCard rejects a missing cardId with 400', async () => {
    const execute = vi.fn();
    const controller = makeController(CARD_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewCard(
      { query: {} } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('getReviewCard maps an offline client to 503', async () => {
    const execute = vi.fn(async () => ({ connected: false, card: null }));
    const controller = makeController(CARD_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewCard(
      { query: { cardId: '9001' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(503);
  });

  test('getReviewCard maps AnkiConnectUnreachableError to 503', async () => {
    const execute = vi.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const controller = makeController(CARD_INDEX, { execute });
    const capture = makeResponse();

    await controller.getReviewCard(
      { query: { cardId: '9001' } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(503);
  });

  test('gradeReviewCard grades and returns 200', async () => {
    const execute = vi.fn(async () => ({ graded: true }));
    const controller = makeController(GRADE_INDEX, { execute });
    const capture = makeResponse();

    await controller.gradeReviewCard(
      { body: { cardId: 9001, ease: 3 } } as unknown as Request,
      capture.res
    );

    expect(execute).toHaveBeenCalledWith({ owner: 42, cardId: 9001, ease: 3 });
    expect(capture.statusCode).toBe(200);
    expect(capture.body).toEqual({ graded: true });
  });

  test('gradeReviewCard rejects a missing cardId with 400', async () => {
    const execute = vi.fn();
    const controller = makeController(GRADE_INDEX, { execute });
    const capture = makeResponse();

    await controller.gradeReviewCard(
      { body: { ease: 3 } } as unknown as Request,
      capture.res
    );

    expect(execute).not.toHaveBeenCalled();
    expect(capture.statusCode).toBe(400);
  });

  test('gradeReviewCard maps InvalidReviewEaseError to 400', async () => {
    const execute = vi.fn(async () => {
      throw new InvalidReviewEaseError();
    });
    const controller = makeController(GRADE_INDEX, { execute });
    const capture = makeResponse();

    await controller.gradeReviewCard(
      { body: { cardId: 9001, ease: 9 } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(400);
  });

  test('gradeReviewCard maps ReviewCardNotFoundError to 404', async () => {
    const execute = vi.fn(async () => {
      throw new ReviewCardNotFoundError();
    });
    const controller = makeController(GRADE_INDEX, { execute });
    const capture = makeResponse();

    await controller.gradeReviewCard(
      { body: { cardId: 9001, ease: 3 } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(404);
  });

  test('gradeReviewCard maps an offline client to 503', async () => {
    const execute = vi.fn(async () => {
      throw new NoActiveAnkifyClientForReviewError();
    });
    const controller = makeController(GRADE_INDEX, { execute });
    const capture = makeResponse();

    await controller.gradeReviewCard(
      { body: { cardId: 9001, ease: 3 } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(503);
  });

  test('gradeReviewCard maps AnkiConnectUnreachableError to 503', async () => {
    const execute = vi.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const controller = makeController(GRADE_INDEX, { execute });
    const capture = makeResponse();

    await controller.gradeReviewCard(
      { body: { cardId: 9001, ease: 3 } } as unknown as Request,
      capture.res
    );

    expect(capture.statusCode).toBe(503);
  });
});
