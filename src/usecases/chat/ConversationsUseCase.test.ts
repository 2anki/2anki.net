import {
  ConversationsUseCase,
  InvalidTitleError,
  InvalidDraftError,
} from './ConversationsUseCase';
import { InMemoryConversationsRepository } from '../../data_layer/ConversationsRepository';
import { InMemoryChatAttachmentsRepository } from '../../data_layer/ChatAttachmentsRepository';

const USER_A = 1;
const USER_B = 2;

describe('ConversationsUseCase', () => {
  describe('list', () => {
    it("returns only the calling user's conversations, newest first", async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);

      const first = await repo.create({ userId: USER_A, title: 'First' });
      const second = await repo.create({ userId: USER_A, title: 'Second' });
      await repo.create({ userId: USER_B, title: 'Theirs' });

      const list = await useCase.list(USER_A);
      expect(list.map((c) => c.id)).toEqual([second, first]);
    });

    it('excludes soft-deleted conversations', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);

      const keep = await repo.create({ userId: USER_A, title: 'Keep' });
      const drop = await repo.create({ userId: USER_A, title: 'Drop' });
      await repo.softDelete({ userId: USER_A, conversationId: drop });

      const list = await useCase.list(USER_A);
      expect(list.map((c) => c.id)).toEqual([keep]);
    });
  });

  describe('get', () => {
    it("returns null for another user's conversation", async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);

      const id = await repo.create({ userId: USER_B, title: 'Theirs' });
      const result = await useCase.get({ userId: USER_A, conversationId: id });

      expect(result).toBeNull();
    });

    it('returns the conversation with ordered messages', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);

      const id = await repo.create({ userId: USER_A, title: 'Conversation' });
      repo.recordMessage({
        userId: USER_A,
        conversationId: id,
        role: 'user',
        content: 'hello',
      });
      repo.recordMessage({
        userId: USER_A,
        conversationId: id,
        role: 'assistant',
        content: 'hi',
      });

      const result = await useCase.get({ userId: USER_A, conversationId: id });
      expect(result?.messages).toEqual([
        expect.objectContaining({ role: 'user', content: 'hello' }),
        expect.objectContaining({ role: 'assistant', content: 'hi' }),
      ]);
    });

    it('hydrates cards from assistant messages that contain a JSON code block', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'Cards' });
      repo.recordMessage({
        userId: USER_A,
        conversationId: id,
        role: 'user',
        content: 'make cards',
      });
      const assistantContent =
        'Here are your cards:\n```json\n[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]\n```\nHope that helps!';
      repo.recordMessage({
        userId: USER_A,
        conversationId: id,
        role: 'assistant',
        content: assistantContent,
      });

      const result = await useCase.get({ userId: USER_A, conversationId: id });
      const assistant = result?.messages.find((m) => m.role === 'assistant');
      expect(assistant?.cards).toEqual([
        { front: 'Q1', back: 'A1' },
        { front: 'Q2', back: 'A2' },
      ]);
      expect(assistant?.contentBefore).toBe('Here are your cards:');
      expect(assistant?.contentAfter).toBe('Hope that helps!');
    });

    it('hydrates MCQ cards from a persisted JSON code block on reload', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'MCQ' });
      const assistantContent =
        'Here are your quiz cards:\n\n```json\n[{"front":"Capital of Albania?","options":["Tirana","Durrës","Vlorë","Shkodër"],"correct_index":0,"rationale":"Tirana is the capital."}]\n```';
      repo.recordMessage({
        userId: USER_A,
        conversationId: id,
        role: 'assistant',
        content: assistantContent,
      });

      const result = await useCase.get({ userId: USER_A, conversationId: id });
      const assistant = result?.messages.find((m) => m.role === 'assistant');
      expect(assistant?.cards).toEqual([
        {
          front: 'Capital of Albania?',
          back: '',
          options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
          correctIndex: 0,
          rationale: 'Tirana is the capital.',
        },
      ]);
    });

    it('does not attach cards to user messages even when their content has JSON', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'Mixed' });
      repo.recordMessage({
        userId: USER_A,
        conversationId: id,
        role: 'user',
        content:
          'Turn this into cards:\n```json\n[{"front":"X","back":"Y"}]\n```',
      });

      const result = await useCase.get({ userId: USER_A, conversationId: id });
      const userMsg = result?.messages.find((m) => m.role === 'user');
      expect((userMsg as { cards?: unknown }).cards).toBeUndefined();
    });

    it('leaves assistant messages without JSON cards untouched', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'Prose' });
      repo.recordMessage({
        userId: USER_A,
        conversationId: id,
        role: 'assistant',
        content: 'Just a plain explanation.',
      });

      const result = await useCase.get({ userId: USER_A, conversationId: id });
      const assistant = result?.messages.find((m) => m.role === 'assistant');
      expect((assistant as { cards?: unknown }).cards).toBeUndefined();
      expect(
        (assistant as { contentBefore?: unknown }).contentBefore
      ).toBeUndefined();
      expect(
        (assistant as { contentAfter?: unknown }).contentAfter
      ).toBeUndefined();
    });
  });

  describe('rename', () => {
    it('rejects empty titles', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'old' });

      await expect(
        useCase.rename({ userId: USER_A, conversationId: id, title: '   ' })
      ).rejects.toBeInstanceOf(InvalidTitleError);
    });

    it('rejects overly long titles', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'old' });

      await expect(
        useCase.rename({
          userId: USER_A,
          conversationId: id,
          title: 'x'.repeat(121),
        })
      ).rejects.toBeInstanceOf(InvalidTitleError);
    });

    it('updates the title when valid', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'old' });

      const ok = await useCase.rename({
        userId: USER_A,
        conversationId: id,
        title: '  fresh title  ',
      });
      expect(ok).toBe(true);
      const conv = await useCase.get({ userId: USER_A, conversationId: id });
      expect(conv?.title).toBe('fresh title');
    });

    it("returns false when renaming another user's conversation", async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_B, title: 'theirs' });

      const ok = await useCase.rename({
        userId: USER_A,
        conversationId: id,
        title: 'mine now',
      });
      expect(ok).toBe(false);
    });
  });

  describe('saveDraft', () => {
    it('stores the draft on the conversation', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'Working' });

      const ok = await useCase.saveDraft({
        userId: USER_A,
        conversationId: id,
        content: 'half-typed message',
      });

      expect(ok).toBe(true);
      const view = await useCase.get({ userId: USER_A, conversationId: id });
      expect(view?.draft).toBe('half-typed message');
    });

    it('treats an empty string as null (clears the draft)', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'Working' });
      await useCase.saveDraft({
        userId: USER_A,
        conversationId: id,
        content: 'hello',
      });

      await useCase.saveDraft({
        userId: USER_A,
        conversationId: id,
        content: '',
      });

      const view = await useCase.get({ userId: USER_A, conversationId: id });
      expect(view?.draft).toBeNull();
    });

    it('clears the draft when content is null', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'Working' });
      await useCase.saveDraft({
        userId: USER_A,
        conversationId: id,
        content: 'hello',
      });

      await useCase.saveDraft({
        userId: USER_A,
        conversationId: id,
        content: null,
      });

      const view = await useCase.get({ userId: USER_A, conversationId: id });
      expect(view?.draft).toBeNull();
    });

    it('rejects drafts over the 100 000 char cap', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'Working' });

      await expect(
        useCase.saveDraft({
          userId: USER_A,
          conversationId: id,
          content: 'x'.repeat(100_001),
        })
      ).rejects.toBeInstanceOf(InvalidDraftError);
    });

    it("returns false when saving to another user's conversation", async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_B, title: 'Theirs' });

      const ok = await useCase.saveDraft({
        userId: USER_A,
        conversationId: id,
        content: 'sneaky',
      });

      expect(ok).toBe(false);
    });
  });

  describe('delete', () => {
    it('soft-deletes the conversation', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'gone' });

      const ok = await useCase.delete({ userId: USER_A, conversationId: id });
      expect(ok).toBe(true);
      expect(await useCase.list(USER_A)).toEqual([]);
    });

    it("returns false when deleting another user's conversation", async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_B, title: 'theirs' });

      const ok = await useCase.delete({ userId: USER_A, conversationId: id });
      expect(ok).toBe(false);
    });

    it('sweeps the conversation attachment prefix and rows on delete', async () => {
      const repo = new InMemoryConversationsRepository();
      const attachments = new InMemoryChatAttachmentsRepository();
      const deleteByPrefix = jest.fn().mockResolvedValue(1);
      const useCase = new ConversationsUseCase(repo, attachments, {
        deleteByPrefix,
      });
      const id = await repo.create({ userId: USER_A, title: 'gone' });
      attachments.messageConversations.set(11, id);
      await attachments.insertMany([
        {
          userId: USER_A,
          messageId: 11,
          s3Key: `chat-attachments/${USER_A}/${id}/11/0-notes.pdf`,
          filename: 'notes.pdf',
          contentType: 'application/pdf',
          byteSize: 4,
        },
      ]);

      const ok = await useCase.delete({ userId: USER_A, conversationId: id });

      expect(ok).toBe(true);
      expect(deleteByPrefix).toHaveBeenCalledWith(
        `chat-attachments/${USER_A}/${id}/`
      );
      expect(attachments.rows).toEqual([]);
    });

    it('does not sweep when the conversation was not deleted', async () => {
      const repo = new InMemoryConversationsRepository();
      const deleteByPrefix = jest.fn();
      const useCase = new ConversationsUseCase(
        repo,
        new InMemoryChatAttachmentsRepository(),
        { deleteByPrefix }
      );

      const ok = await useCase.delete({ userId: USER_A, conversationId: 999 });

      expect(ok).toBe(false);
      expect(deleteByPrefix).not.toHaveBeenCalled();
    });

    it('returns false on the second delete', async () => {
      const repo = new InMemoryConversationsRepository();
      const useCase = new ConversationsUseCase(repo);
      const id = await repo.create({ userId: USER_A, title: 'gone' });

      await useCase.delete({ userId: USER_A, conversationId: id });
      const second = await useCase.delete({
        userId: USER_A,
        conversationId: id,
      });
      expect(second).toBe(false);
    });
  });
});
