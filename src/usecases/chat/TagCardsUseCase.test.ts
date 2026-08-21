import { parseTagsResponse, TagCardsUseCase } from './TagCardsUseCase';
import { InMemoryChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';

describe('parseTagsResponse', () => {
  it('returns one normalized list per card', () => {
    const out = parseTagsResponse(
      '[["geography","norway"],["math","fractions"]]',
      2
    );
    expect(out).toEqual([
      ['geography', 'norway'],
      ['math', 'fractions'],
    ]);
  });

  it('lowercases, hyphenates spaces, strips junk', () => {
    const out = parseTagsResponse('[["Cellular Biology","ATP!!"]]', 1);
    expect(out).toEqual([['cellular-biology', 'atp']]);
  });

  it('drops duplicates and caps at three per card', () => {
    const out = parseTagsResponse('[["a","a","b","c","d","e"]]', 1);
    expect(out[0]).toHaveLength(3);
    expect(out[0]).toEqual(['a', 'b', 'c']);
  });

  it('strips fenced markdown wrapping', () => {
    const out = parseTagsResponse('```json\n[["chemistry"]]\n```', 1);
    expect(out).toEqual([['chemistry']]);
  });

  it('falls back to empty arrays on malformed JSON', () => {
    const out = parseTagsResponse('not json', 3);
    expect(out).toEqual([[], [], []]);
  });

  it('pads to expectedLength when model returns fewer entries', () => {
    const out = parseTagsResponse('[["one"]]', 3);
    expect(out).toEqual([['one'], [], []]);
  });

  it('rejects tags that fail the slug pattern', () => {
    const out = parseTagsResponse(
      '[["-leading-dash","valid","this-is-way-too-long-to-keep-around"]]',
      1
    );
    expect(out[0]).toEqual(['valid']);
  });
});

describe('TagCardsUseCase', () => {
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

  it('returns empty tags array when no cards are passed', async () => {
    const anthropic = makeAnthropic('');
    const useCase = new TagCardsUseCase(anthropic);
    const result = await useCase.execute({ cards: [] });
    expect(result).toEqual({ tags: [] });
  });

  it('calls Anthropic with haiku and returns parsed tags', async () => {
    const anthropic = makeAnthropic('[["geography"],["math"]]');
    const useCase = new TagCardsUseCase(anthropic);
    const result = await useCase.execute({
      cards: [
        { front: 'Capital of Norway?', back: 'Oslo' },
        { front: '2 + 2', back: '4' },
      ],
    });
    expect(result.tags).toEqual([['geography'], ['math']]);
    const create = (anthropic.messages as unknown as { create: jest.Mock })
      .create;
    const call = create.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
  });

  it('persists tags by rewriting the latest assistant message when repo + conversation are provided', async () => {
    const anthropic = makeAnthropic('[["geography","norway"]]');
    const stored =
      'Here you go:\n\n```json\n[{"front":"Capital?","back":"Oslo"}]\n```\n\nLet me know.';
    const repo = {
      insert: jest.fn(),
      listForConversation: jest.fn().mockResolvedValue([]),
      findLatestAssistantInConversation: jest
        .fn()
        .mockResolvedValue({ id: 42, content: stored }),
      updateContent: jest.fn().mockResolvedValue(true),
      deleteById: jest.fn().mockResolvedValue(true),
      deleteAllForUser: jest.fn().mockResolvedValue(0),
    };
    const useCase = new TagCardsUseCase(anthropic, repo);
    await useCase.execute({
      cards: [{ front: 'Capital?', back: 'Oslo' }],
      userId: 7,
      conversationId: 13,
    });
    expect(repo.findLatestAssistantInConversation).toHaveBeenCalledWith({
      userId: 7,
      conversationId: 13,
    });
    expect(repo.updateContent).toHaveBeenCalled();
    const updated = repo.updateContent.mock.calls[0][0] as {
      messageId: number;
      userId: number;
      content: string;
    };
    expect(updated.messageId).toBe(42);
    expect(updated.userId).toBe(7);
    expect(updated.content).toContain('"tags":["geography","norway"]');
    expect(updated.content).toContain('Here you go:');
    expect(updated.content).toContain('Let me know.');
  });

  it('does not touch the DB when conversationId is omitted', async () => {
    const anthropic = makeAnthropic('[["geography"]]');
    const repo = {
      insert: jest.fn(),
      listForConversation: jest.fn().mockResolvedValue([]),
      findLatestAssistantInConversation: jest.fn(),
      updateContent: jest.fn(),
      deleteById: jest.fn(),
      deleteAllForUser: jest.fn(),
    };
    const useCase = new TagCardsUseCase(anthropic, repo);
    await useCase.execute({
      cards: [{ front: 'q', back: 'a' }],
      userId: 7,
    });
    expect(repo.findLatestAssistantInConversation).not.toHaveBeenCalled();
    expect(repo.updateContent).not.toHaveBeenCalled();
  });

  it('tags cards regardless of how many messages the user has sent', async () => {
    const anthropic = makeAnthropic('[["geography"]]');
    const create = (anthropic.messages as unknown as { create: jest.Mock })
      .create;
    const repo = new InMemoryChatMessagesRepository();
    for (let i = 0; i < 50; i++) {
      await repo.insert({
        userId: 7,
        conversationId: null,
        role: 'user',
        content: `msg ${i}`,
      });
    }
    const useCase = new TagCardsUseCase(anthropic, repo);

    const result = await useCase.execute({
      cards: [{ front: 'q', back: 'a' }],
      userId: 7,
    });

    expect(result.tags).toEqual([['geography']]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
