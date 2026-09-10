import { Request, Response } from 'express';
import ChatDeckController from './ChatDeckController';
import { MonthlyLimitError } from '../usecases/users/CheckMonthlyCardLimitUseCase';

function buildRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    locals: { owner: 42 },
  } as unknown as Response;
}

function buildReq(body: unknown): Request {
  return { body } as unknown as Request;
}

const validCards = [
  { front: 'Q1', back: 'A1' },
  { front: 'Q2', back: 'A2' },
];

describe('ChatDeckController.generate', () => {
  it('returns 400 when deckName is missing', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(buildReq({ cards: validCards }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when deckName is empty string', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: validCards, deckName: '' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when deckName exceeds 120 chars', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: validCards, deckName: 'x'.repeat(121) }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when cards is not an array', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: 'not-an-array', deckName: 'My Deck' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when cards is empty', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: [], deckName: 'My Deck' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when cards array exceeds 200 items', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();
    const tooManyCards = Array.from({ length: 201 }, (_, i) => ({
      front: `Q${i}`,
      back: `A${i}`,
    }));

    await controller.generate(
      buildReq({ cards: tooManyCards, deckName: 'My Deck' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when a card is missing front field', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: [{ back: 'A1' }], deckName: 'My Deck' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when a card is missing back field', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: [{ front: 'Q1' }], deckName: 'My Deck' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a valid MCQ-shaped card and forwards it to the use case', async () => {
    const fakeBuffer = Buffer.from('fake-apkg-data');
    const useCase = { execute: jest.fn().mockResolvedValue(fakeBuffer) };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();
    const mcqCard = {
      front: 'Which enzyme breaks down starch?',
      options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
      correctIndex: 1,
      rationale: 'Amylase.',
    };

    await controller.generate(
      buildReq({ cards: [mcqCard], deckName: 'Quiz' }),
      res
    );

    expect(useCase.execute).toHaveBeenCalledWith({
      cards: [
        {
          front: 'Which enzyme breaks down starch?',
          back: '',
          options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
          correctIndex: 1,
          rationale: 'Amylase.',
        },
      ],
      deckName: 'Quiz',
      templateSlug: null,
      userId: 42,
      isPaying: false,
    });
    expect(res.send).toHaveBeenCalledWith(fakeBuffer);
  });

  it('rejects an MCQ-shaped card with 3 options', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();
    const badMcq = {
      front: 'Q',
      options: ['A', 'B', 'C'],
      correctIndex: 0,
    };

    await controller.generate(
      buildReq({ cards: [badMcq], deckName: 'Quiz' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('rejects an MCQ-shaped card with an out-of-range correctIndex', async () => {
    const useCase = { execute: jest.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();
    const badMcq = {
      front: 'Q',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 9,
    };

    await controller.generate(
      buildReq({ cards: [badMcq], deckName: 'Quiz' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('calls use case and sends buffer on valid input', async () => {
    const fakeBuffer = Buffer.from('fake-apkg-data');
    const useCase = { execute: jest.fn().mockResolvedValue(fakeBuffer) };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: validCards, deckName: 'My Deck' }),
      res
    );

    expect(useCase.execute).toHaveBeenCalledWith({
      cards: validCards,
      deckName: 'My Deck',
      templateSlug: null,
      userId: 42,
      isPaying: false,
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/octet-stream'
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="My Deck.apkg"; filename*=UTF-8\'\'My%20Deck.apkg'
    );
    expect(res.send).toHaveBeenCalledWith(fakeBuffer);
  });

  it('maps a MonthlyLimitError to a 402 with the monthly_limit shape and sends no deck', async () => {
    const resetOn = '2026-10-01T00:00:00.000Z';
    const useCase = {
      execute: jest
        .fn()
        .mockRejectedValue(new MonthlyLimitError(100, 100, 2, resetOn)),
    };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(
      buildReq({ cards: validCards, deckName: 'My Deck' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({
      code: 'monthly_limit',
      cards_used: 100,
      limit: 100,
      reset_on: resetOn,
    });
    expect(res.send).not.toHaveBeenCalled();
  });
});
