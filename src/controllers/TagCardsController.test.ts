import type { Request, Response } from 'express';
import TagCardsController from './TagCardsController';
import { TagCardsUseCase } from '../usecases/chat/TagCardsUseCase';
import { InMemoryChatMessagesRepository } from '../data_layer/ChatMessagesRepository';

function makeAnthropic(text: string) {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    },
  } as unknown as ConstructorParameters<typeof TagCardsUseCase>[0];
}

function makeRes(locals: Record<string, unknown>) {
  const res = {
    locals,
    statusCode: 0,
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
  return res as unknown as Response & {
    statusCode: number;
    body: unknown;
  };
}

describe('TagCardsController', () => {
  it('returns tags without any monthly cap on message history', async () => {
    const anthropic = makeAnthropic('[["geography"]]');
    const repo = new InMemoryChatMessagesRepository();
    for (let i = 0; i < 50; i++) {
      await repo.insert({
        userId: 7,
        conversationId: null,
        role: 'user',
        content: `msg ${i}`,
      });
    }
    const controller = new TagCardsController(
      new TagCardsUseCase(anthropic, repo)
    );

    const req = { body: { cards: [{ front: 'q', back: 'a' }] } } as Request;
    const res = makeRes({ owner: 7, patreon: false, subscriber: true });

    await controller.tag(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ tags: [['geography']] });
  });

  it('rejects a request with no cards array', async () => {
    const anthropic = makeAnthropic('[]');
    const controller = new TagCardsController(
      new TagCardsUseCase(anthropic, new InMemoryChatMessagesRepository())
    );

    const req = { body: {} } as Request;
    const res = makeRes({ owner: 7, patreon: false, subscriber: true });

    await controller.tag(req, res);

    expect(res.statusCode).toBe(400);
  });
});
