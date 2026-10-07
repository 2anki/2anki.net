import { vi } from 'vitest';
import { Request, Response } from 'express';
import ChatDeckController from './ChatDeckController';
import { MonthlyLimitError } from '../usecases/users/CheckMonthlyCardLimitUseCase';

function buildRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
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
  const rejectionCases: Array<[string, unknown]> = [
    ['deckName is missing', { cards: validCards }],
    ['deckName is empty string', { cards: validCards, deckName: '' }],
    [
      'deckName exceeds 120 chars',
      { cards: validCards, deckName: 'x'.repeat(121) },
    ],
    ['cards is not an array', { cards: 'not-an-array', deckName: 'My Deck' }],
    ['cards is empty', { cards: [], deckName: 'My Deck' }],
    [
      'cards array exceeds 200 items',
      {
        cards: Array.from({ length: 201 }, (_, i) => ({
          front: `Q${i}`,
          back: `A${i}`,
        })),
        deckName: 'My Deck',
      },
    ],
    [
      'a card is missing front field',
      { cards: [{ back: 'A1' }], deckName: 'My Deck' },
    ],
    [
      'a card is missing back field',
      { cards: [{ front: 'Q1' }], deckName: 'My Deck' },
    ],
  ];

  it.each(rejectionCases)('returns 400 when %s', async (_label, body) => {
    const useCase = { execute: vi.fn() };
    const controller = new ChatDeckController(useCase as never);
    const res = buildRes();

    await controller.generate(buildReq(body), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a valid MCQ-shaped card and forwards it to the use case', async () => {
    const fakeBuffer = Buffer.from('fake-apkg-data');
    const useCase = { execute: vi.fn().mockResolvedValue(fakeBuffer) };
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
    const useCase = { execute: vi.fn() };
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
    const useCase = { execute: vi.fn() };
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
    const useCase = { execute: vi.fn().mockResolvedValue(fakeBuffer) };
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
      execute: vi
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
