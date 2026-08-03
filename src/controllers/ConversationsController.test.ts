import { Request, Response } from 'express';
import ConversationsController from './ConversationsController';
import {
  ConversationsUseCase,
  InvalidTitleError,
} from '../usecases/chat/ConversationsUseCase';
import { InMemoryConversationsRepository } from '../data_layer/ConversationsRepository';
import { InMemoryChatMessagesRepository } from '../data_layer/ChatMessagesRepository';
import { DeleteAllConversationsUseCase } from '../usecases/chat/DeleteAllConversationsUseCase';

function buildRes(owner = 42): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    locals: { owner },
  } as unknown as Response;
}

function buildReq(input: {
  params?: Record<string, string>;
  body?: unknown;
}): Request {
  return {
    params: input.params ?? {},
    body: input.body,
  } as unknown as Request;
}

describe('ConversationsController', () => {
  describe('list', () => {
    it("returns the user's conversations sorted by use case order", async () => {
      const repo = new InMemoryConversationsRepository();
      const a = await repo.create({ userId: 42, title: 'First' });
      const b = await repo.create({ userId: 42, title: 'Second' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.list(buildReq({}), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        conversations: [
          expect.objectContaining({ id: b, title: 'Second' }),
          expect.objectContaining({ id: a, title: 'First' }),
        ],
      });
    });
  });

  describe('get', () => {
    it('returns 400 for invalid id', async () => {
      const controller = new ConversationsController(
        new ConversationsUseCase(new InMemoryConversationsRepository()),
        new DeleteAllConversationsUseCase(
          new InMemoryConversationsRepository(),
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes();

      await controller.get(buildReq({ params: { id: 'abc' } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when conversation belongs to another user', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 99, title: 'theirs' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.get(buildReq({ params: { id: String(id) } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns the conversation with messages', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'mine' });
      repo.recordMessage({
        userId: 42,
        conversationId: id,
        role: 'user',
        content: 'hi',
      });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.get(buildReq({ params: { id: String(id) } }), res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          title: 'mine',
          messages: [expect.objectContaining({ role: 'user', content: 'hi' })],
        })
      );
    });
  });

  describe('rename', () => {
    it('returns 400 when title missing', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'old' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.rename(
        buildReq({ params: { id: String(id) }, body: {} }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when title is empty after trimming', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'old' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.rename(
        buildReq({ params: { id: String(id) }, body: { title: '   ' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 204 on rename success', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'old' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.rename(
        buildReq({ params: { id: String(id) }, body: { title: 'new' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 404 when conversation belongs to another user', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 99, title: 'theirs' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.rename(
        buildReq({ params: { id: String(id) }, body: { title: 'mine' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('saveDraft', () => {
    it('returns 400 when content is missing', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'work' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.saveDraft(
        buildReq({ params: { id: String(id) }, body: {} }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('accepts a string draft and returns 204', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'work' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.saveDraft(
        buildReq({
          params: { id: String(id) },
          body: { content: 'in-progress' },
        }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('accepts null content to clear the draft', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'work' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.saveDraft(
        buildReq({ params: { id: String(id) }, body: { content: null } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 400 when content is over the size cap', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'work' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.saveDraft(
        buildReq({
          params: { id: String(id) },
          body: { content: 'x'.repeat(100_001) },
        }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the conversation belongs to another user', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 99, title: 'theirs' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.saveDraft(
        buildReq({ params: { id: String(id) }, body: { content: 'sneaky' } }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('delete', () => {
    it('returns 204 on success', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 42, title: 'gone' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.delete(buildReq({ params: { id: String(id) } }), res);

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 404 when conversation belongs to another user', async () => {
      const repo = new InMemoryConversationsRepository();
      const id = await repo.create({ userId: 99, title: 'theirs' });
      const controller = new ConversationsController(
        new ConversationsUseCase(repo),
        new DeleteAllConversationsUseCase(
          repo,
          new InMemoryChatMessagesRepository()
        )
      );
      const res = buildRes(42);

      await controller.delete(buildReq({ params: { id: String(id) } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});

describe('deleteAll', () => {
  it('purges every conversation for the owner and returns 204', async () => {
    const repo = new InMemoryConversationsRepository();
    const messages = new InMemoryChatMessagesRepository();
    await repo.create({ userId: 42, title: 'One' });
    await repo.create({ userId: 42, title: 'Two' });
    await repo.create({ userId: 7, title: 'Not mine' });
    await messages.insert({
      userId: 42,
      conversationId: null,
      role: 'user',
      content: 'legacy',
    });
    const controller = new ConversationsController(
      new ConversationsUseCase(repo),
      new DeleteAllConversationsUseCase(repo, messages)
    );
    const res = buildRes(42);

    await controller.deleteAll(buildReq({}), res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(await repo.listForUser(42)).toEqual([]);
    expect(await repo.listForUser(7)).toHaveLength(1);
    expect(messages.getAll()).toEqual([]);
  });

  it('returns 204 when there is nothing to delete', async () => {
    const controller = new ConversationsController(
      new ConversationsUseCase(new InMemoryConversationsRepository()),
      new DeleteAllConversationsUseCase(
        new InMemoryConversationsRepository(),
        new InMemoryChatMessagesRepository()
      )
    );
    const res = buildRes(42);

    await controller.deleteAll(buildReq({}), res);

    expect(res.status).toHaveBeenCalledWith(204);
  });
});
