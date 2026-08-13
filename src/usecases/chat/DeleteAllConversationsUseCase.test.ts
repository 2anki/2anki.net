import { DeleteAllConversationsUseCase } from './DeleteAllConversationsUseCase';
import { InMemoryConversationsRepository } from '../../data_layer/ConversationsRepository';
import { InMemoryChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';

describe('DeleteAllConversationsUseCase', () => {
  it('hard-deletes every conversation and message for the user, and only theirs', async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryChatMessagesRepository();
    const useCase = new DeleteAllConversationsUseCase(conversations, messages);

    const mine = await conversations.create({ userId: 1, title: 'Mine' });
    const alsoMine = await conversations.create({ userId: 1, title: 'Also' });
    const theirs = await conversations.create({ userId: 2, title: 'Theirs' });
    await messages.insert({
      userId: 1,
      conversationId: mine,
      role: 'user',
      content: 'hello',
      attachmentText: 'my private document text',
    });
    await messages.insert({
      userId: 1,
      conversationId: alsoMine,
      role: 'assistant',
      content: 'cards',
    });
    await messages.insert({
      userId: 2,
      conversationId: theirs,
      role: 'user',
      content: 'other user',
    });

    const deleted = await useCase.execute(1);

    expect(deleted).toBe(2);
    expect(await conversations.listForUser(1)).toEqual([]);
    expect(await conversations.listForUser(2)).toHaveLength(1);
    expect(messages.getAll().map((m) => m.user_id)).toEqual([2]);
  });

  it('removes soft-deleted conversations and orphaned messages too', async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryChatMessagesRepository();
    const useCase = new DeleteAllConversationsUseCase(conversations, messages);

    const softDeleted = await conversations.create({ userId: 1, title: 'Old' });
    await conversations.softDelete({ userId: 1, conversationId: softDeleted });
    await messages.insert({
      userId: 1,
      conversationId: softDeleted,
      role: 'user',
      content: 'lingering after soft delete',
    });
    await messages.insert({
      userId: 1,
      conversationId: null,
      role: 'user',
      content: 'legacy message with no conversation',
    });

    const deleted = await useCase.execute(1);

    expect(deleted).toBe(1);
    expect(messages.getAll()).toEqual([]);
  });

  it('returns 0 for a user with nothing to delete', async () => {
    const useCase = new DeleteAllConversationsUseCase(
      new InMemoryConversationsRepository(),
      new InMemoryChatMessagesRepository()
    );
    expect(await useCase.execute(99)).toBe(0);
  });
});

describe('DeleteAllConversationsUseCase attachment sweep', () => {
  it('sweeps the user attachment prefix before deleting rows', async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryChatMessagesRepository();
    const deleteByPrefix = jest.fn().mockResolvedValue(2);
    const useCase = new DeleteAllConversationsUseCase(conversations, messages, {
      deleteByPrefix,
    });

    await useCase.execute(7);

    expect(deleteByPrefix).toHaveBeenCalledWith('chat-attachments/7/');
  });

  it('still deletes rows when the sweep fails', async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryChatMessagesRepository();
    await conversations.create({ userId: 7, title: 'Mine' });
    const deleteByPrefix = jest
      .fn()
      .mockRejectedValue(new Error('storage down'));
    const useCase = new DeleteAllConversationsUseCase(conversations, messages, {
      deleteByPrefix,
    });

    const deleted = await useCase.execute(7);

    expect(deleted).toBe(1);
    expect(await conversations.listForUser(7)).toEqual([]);
  });
});
