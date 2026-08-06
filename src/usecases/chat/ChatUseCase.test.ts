import { zipSync, strToU8 } from 'fflate';
import {
  ChatUseCase,
  ChatRateLimitError,
  ChatConversationNotFoundError,
  McqExtractionFailedError,
  extractCards,
} from './ChatUseCase';
import { ConversationsUseCase } from './ConversationsUseCase';
import { InMemoryChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';
import { InMemoryConversationsRepository } from '../../data_layer/ConversationsRepository';

jest.mock(
  '../../infrastracture/adapters/fileConversion/convertDocxToHTML',
  () => ({
    convertDocxToHTML: jest.fn(),
  })
);

import { convertDocxToHTML } from '../../infrastracture/adapters/fileConversion/convertDocxToHTML';

const mockedConvertDocx = convertDocxToHTML as jest.MockedFunction<
  typeof convertDocxToHTML
>;

const ZIP_MIME = 'application/zip';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MARKDOWN_MIME = 'text/markdown';
const PLAIN_TEXT_MIME = 'text/plain';

function notionZip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, contents] of Object.entries(files)) {
    entries[name] = strToU8(contents);
  }
  return Buffer.from(zipSync(entries));
}

function lastUserText(stream: jest.Mock): string {
  const callArg = stream.mock.calls[0][0];
  const lastMessage = callArg.messages[callArg.messages.length - 1];
  if (typeof lastMessage.content === 'string') return lastMessage.content;
  const textBlock = lastMessage.content.find(
    (block: { type: string }) => block.type === 'text'
  );
  return textBlock?.text ?? '';
}

const FREE_USER = { owner: 1, patreon: false } as const;
const PATREON_USER = { owner: 2, patreon: true } as const;

function buildAnthropicMockWithBlocks(content: unknown[]) {
  const mockStream = {
    on: jest.fn().mockReturnThis(),
    finalMessage: jest.fn().mockResolvedValue({ content }),
  };
  return {
    messages: {
      stream: jest.fn().mockReturnValue(mockStream),
    },
  };
}

function buildAnthropicMock(responseContent: string) {
  return buildAnthropicMockWithBlocks([
    { type: 'text', text: responseContent },
  ]);
}

function buildUseCase(responseContent: string) {
  const messagesRepo = new InMemoryChatMessagesRepository();
  const conversationsRepo = new InMemoryConversationsRepository();
  const anthropic = buildAnthropicMock(responseContent);
  const useCase = new ChatUseCase(
    messagesRepo,
    conversationsRepo,
    anthropic as never
  );
  return { messagesRepo, conversationsRepo, anthropic, useCase };
}

function buildUseCaseWithBlocks(content: unknown[]) {
  const messagesRepo = new InMemoryChatMessagesRepository();
  const conversationsRepo = new InMemoryConversationsRepository();
  const anthropic = buildAnthropicMockWithBlocks(content);
  const useCase = new ChatUseCase(
    messagesRepo,
    conversationsRepo,
    anthropic as never
  );
  return { messagesRepo, conversationsRepo, anthropic, useCase };
}

describe('ChatUseCase', () => {
  describe('message counting and rate limiting', () => {
    it('throws ChatRateLimitError when free user has used 20 messages this month', async () => {
      const { messagesRepo, useCase } = buildUseCase('Hello');
      for (let i = 0; i < 20; i++) {
        await messagesRepo.insert({
          userId: FREE_USER.owner,
          conversationId: null,
          role: 'user',
          content: `msg ${i}`,
        });
      }

      await expect(
        useCase.execute({
          user: FREE_USER,
          content: 'another message',
          conversationHistory: [],
        })
      ).rejects.toBeInstanceOf(ChatRateLimitError);
    });

    it('does not throw when free user has used fewer than 20 messages', async () => {
      const { messagesRepo, useCase } = buildUseCase('Nice response');
      for (let i = 0; i < 19; i++) {
        await messagesRepo.insert({
          userId: FREE_USER.owner,
          conversationId: null,
          role: 'user',
          content: `msg ${i}`,
        });
      }

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
      });
      expect(result.content).toBe('Nice response');
    });

    it('does not apply limit to patreon users', async () => {
      const { messagesRepo, useCase } = buildUseCase('Patreon response');
      for (let i = 0; i < 100; i++) {
        await messagesRepo.insert({
          userId: PATREON_USER.owner,
          conversationId: null,
          role: 'user',
          content: `msg ${i}`,
        });
      }

      const result = await useCase.execute({
        user: PATREON_USER,
        content: 'question',
        conversationHistory: [],
      });
      expect(result.content).toBe('Patreon response');
    });
  });

  describe('model selection', () => {
    it('uses haiku model for free users', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
      });

      expect(anthropic.messages.stream).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
      );
    });

    it('uses sonnet model for patreon users', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: PATREON_USER,
        content: 'question',
        conversationHistory: [],
      });

      expect(anthropic.messages.stream).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' })
      );
    });
  });

  describe('card extraction', () => {
    it('extracts cards when response contains a JSON code block', async () => {
      const cards = [
        { front: 'Q1', back: 'A1' },
        { front: 'Q2', back: 'A2' },
      ];
      const responseText = `Here are your cards:\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\`\nHope that helps!`;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards about photosynthesis',
        conversationHistory: [],
      });

      expect(result.cards).toEqual(cards);
    });

    it('extracts tags from JSON cards when present (persisted-tag round trip)', async () => {
      const cards = [
        { front: 'Capital?', back: 'Oslo', tags: ['geography', 'norway'] },
      ];
      const responseText = `Here:\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'noop',
        conversationHistory: [],
      });

      expect(result.cards?.[0].tags).toEqual(['geography', 'norway']);
    });

    it('returns no cards when response has no JSON block', async () => {
      const { useCase } = buildUseCase(
        'Photosynthesis is the process by which...'
      );

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Explain photosynthesis',
        conversationHistory: [],
      });

      expect(result.cards).toBeUndefined();
    });

    it('returns no cards when JSON block is not a front/back array', async () => {
      const responseText = 'Here is JSON:\n```json\n{"key": "value"}\n```';
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'some question',
        conversationHistory: [],
      });

      expect(result.cards).toBeUndefined();
    });

    it('returns contentBefore and contentAfter when JSON block is surrounded by prose', async () => {
      const cards = [{ front: 'Q1', back: 'A1' }];
      const responseText = `Here are your cards:\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\`\nHope that helps!`;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
      });

      expect(result.contentBefore).toBe('Here are your cards:');
      expect(result.contentAfter).toBe('Hope that helps!');
    });

    it('returns contentBefore as undefined when no text before JSON block', async () => {
      const cards = [{ front: 'Q1', back: 'A1' }];
      const responseText = `\`\`\`json\n${JSON.stringify(cards)}\n\`\`\`\nHope that helps!`;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
      });

      expect(result.contentBefore).toBeUndefined();
      expect(result.contentAfter).toBe('Hope that helps!');
    });

    it('returns contentAfter as undefined when no text after JSON block', async () => {
      const cards = [{ front: 'Q1', back: 'A1' }];
      const responseText = `Here are your cards:\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
      });

      expect(result.contentBefore).toBe('Here are your cards:');
      expect(result.contentAfter).toBeUndefined();
    });

    it('returns undefined contentBefore and contentAfter when no JSON block present', async () => {
      const { useCase } = buildUseCase('Just plain text response.');

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Explain something',
        conversationHistory: [],
      });

      expect(result.contentBefore).toBeUndefined();
      expect(result.contentAfter).toBeUndefined();
    });

    it('extracts a trailing Deck: line as deckName and strips it from contentBefore', async () => {
      const cards = [{ front: 'Q1', back: 'A1' }];
      const responseText = `Here are your cards:\nDeck: Cell Biology — Mitosis\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
      });

      expect(result.deckName).toBe('Cell Biology — Mitosis');
      expect(result.contentBefore).toBe('Here are your cards:');
    });

    it('returns deckName when the Deck: line is the only prose before the block', async () => {
      const cards = [{ front: 'Q1', back: 'A1' }];
      const responseText = `Deck: Spanish Verbs\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
      });

      expect(result.deckName).toBe('Spanish Verbs');
      expect(result.contentBefore).toBeUndefined();
    });

    it('does not treat a mid-prose Deck: mention as the deck name', async () => {
      const cards = [{ front: 'Q1', back: 'A1' }];
      const responseText = `Deck: building is fun, as I always say.\nHere you go:\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
      });

      expect(result.deckName).toBeUndefined();
      expect(result.contentBefore).toBe(
        'Deck: building is fun, as I always say.\nHere you go:'
      );
    });

    it('omits deckName when no Deck: line is present', async () => {
      const cards = [{ front: 'Q1', back: 'A1' }];
      const responseText = `Here are your cards:\n\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
      });

      expect(result.deckName).toBeUndefined();
      expect(result.contentBefore).toBe('Here are your cards:');
    });

    it('normalizes stray cloze cards to plain front/back when templateSlug is basic', async () => {
      const cards = [
        { front: 'The capital of {{c1::France}} is Paris.', back: '' },
      ];
      const responseText = `\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make basic cards',
        conversationHistory: [],
        templateSlug: 'basic',
      });

      expect(result.cards).toEqual([
        { front: 'The capital of [...] is Paris.', back: 'France' },
      ]);
    });

    it('joins multiple cloze answers on the back when templateSlug is basic', async () => {
      const cards = [
        {
          front: '{{c1::Mitochondria}} is the {{c2::powerhouse}} of the cell.',
          back: '',
        },
      ];
      const responseText = `\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make basic cards',
        conversationHistory: [],
        templateSlug: 'basic',
      });

      expect(result.cards).toEqual([
        {
          front: '[...] is the [...] of the cell.',
          back: 'Mitochondria, powerhouse',
        },
      ]);
    });

    it('normalizes stray cloze when templateSlug is basic-and-reversed', async () => {
      const cards = [
        { front: 'The capital of {{c1::France}} is Paris.', back: '' },
      ];
      const responseText = `\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make reversible cards',
        conversationHistory: [],
        templateSlug: 'basic-and-reversed',
      });

      expect(result.cards).toEqual([
        { front: 'The capital of [...] is Paris.', back: 'France' },
      ]);
    });

    it('passes cloze cards through untouched when templateSlug is cloze', async () => {
      const cards = [
        { front: 'The capital of {{c1::France}} is Paris.', back: '' },
      ];
      const responseText = `\`\`\`json\n${JSON.stringify(cards)}\n\`\`\``;
      const { useCase } = buildUseCase(responseText);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Make cloze cards',
        conversationHistory: [],
        templateSlug: 'cloze',
      });

      expect(result.cards).toEqual(cards);
    });
  });

  describe('message persistence', () => {
    it('saves both user and assistant messages with the same conversation_id', async () => {
      const { messagesRepo, useCase } = buildUseCase('Assistant reply');

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'User question',
        conversationHistory: [],
      });

      const all = messagesRepo.getAll();
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({
        user_id: FREE_USER.owner,
        role: 'user',
        content: 'User question',
        conversation_id: result.conversationId,
      });
      expect(all[1]).toMatchObject({
        user_id: FREE_USER.owner,
        role: 'assistant',
        content: 'Assistant reply',
        conversation_id: result.conversationId,
      });
    });
  });

  describe('draft auto-clear', () => {
    it('clears the conversation draft after a successful assistant reply', async () => {
      const { conversationsRepo, useCase } = buildUseCase('reply');
      const id = await conversationsRepo.create({
        userId: FREE_USER.owner,
        title: 'With draft',
      });
      await conversationsRepo.saveDraft({
        userId: FREE_USER.owner,
        conversationId: id,
        content: 'half-typed prompt',
      });

      await useCase.execute({
        user: FREE_USER,
        content: 'final prompt',
        conversationHistory: [],
        conversationId: id,
      });

      const conv = await conversationsRepo.findForUser({
        userId: FREE_USER.owner,
        conversationId: id,
      });
      expect(conv?.draft).toBeNull();
    });
  });

  describe('conversation management', () => {
    it('creates a new conversation when no conversationId is provided', async () => {
      const { conversationsRepo, useCase } = buildUseCase('reply');

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'Hello there',
        conversationHistory: [],
      });

      const list = await conversationsRepo.listForUser(FREE_USER.owner);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(result.conversationId);
    });

    it('auto-titles the new conversation from the first user message', async () => {
      const { conversationsRepo, useCase } = buildUseCase('reply');

      await useCase.execute({
        user: FREE_USER,
        content: 'Explain mitosis briefly please',
        conversationHistory: [],
      });

      const list = await conversationsRepo.listForUser(FREE_USER.owner);
      expect(list[0].title).toBe('Explain mitosis briefly please');
    });

    it('truncates long auto-titles with an ellipsis', async () => {
      const { conversationsRepo, useCase } = buildUseCase('reply');
      const longInput =
        'This is a very long opening user message that absolutely will exceed the auto title cap of sixty characters by a wide margin.';

      await useCase.execute({
        user: FREE_USER,
        content: longInput,
        conversationHistory: [],
      });

      const list = await conversationsRepo.listForUser(FREE_USER.owner);
      expect(list[0].title.length).toBeLessThanOrEqual(61);
      expect(list[0].title.endsWith('…')).toBe(true);
    });

    it('reuses an existing conversation when a valid conversationId is provided', async () => {
      const { conversationsRepo, messagesRepo, useCase } =
        buildUseCase('reply');
      const existingId = await conversationsRepo.create({
        userId: FREE_USER.owner,
        title: 'Already here',
      });

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'follow-up',
        conversationHistory: [],
        conversationId: existingId,
      });

      expect(result.conversationId).toBe(existingId);
      const all = messagesRepo.getAll();
      expect(all.every((m) => m.conversation_id === existingId)).toBe(true);
      const list = await conversationsRepo.listForUser(FREE_USER.owner);
      expect(list).toHaveLength(1);
    });

    it('throws ChatConversationNotFoundError when the conversationId does not exist', async () => {
      const { useCase } = buildUseCase('reply');

      await expect(
        useCase.execute({
          user: FREE_USER,
          content: 'nope',
          conversationHistory: [],
          conversationId: 9999,
        })
      ).rejects.toBeInstanceOf(ChatConversationNotFoundError);
    });

    it('throws ChatConversationNotFoundError when the conversationId belongs to another user', async () => {
      const { conversationsRepo, useCase } = buildUseCase('reply');
      const theirs = await conversationsRepo.create({
        userId: PATREON_USER.owner,
        title: 'Theirs',
      });

      await expect(
        useCase.execute({
          user: FREE_USER,
          content: 'sneaky',
          conversationHistory: [],
          conversationId: theirs,
        })
      ).rejects.toBeInstanceOf(ChatConversationNotFoundError);
    });
  });

  describe('attachments', () => {
    it('sends a mixed-content user turn when attachments are provided', async () => {
      const { anthropic, useCase } = buildUseCase('answer');
      const attachment = {
        mimeType: 'image/png',
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      };

      await useCase.execute({
        user: FREE_USER,
        content: 'Explain this diagram',
        conversationHistory: [],
        attachments: [attachment],
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      const lastMessage = callArg.messages[callArg.messages.length - 1];
      expect(Array.isArray(lastMessage.content)).toBe(true);
      expect(lastMessage.content).toHaveLength(2);
      expect(lastMessage.content[0]).toMatchObject({ type: 'image' });
      expect(lastMessage.content[1]).toMatchObject({
        type: 'text',
        text: 'Explain this diagram',
      });
    });

    it('sends a plain string user turn when no attachments are provided', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'Plain message',
        conversationHistory: [],
        attachments: [],
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      const lastMessage = callArg.messages[callArg.messages.length - 1];
      expect(typeof lastMessage.content).toBe('string');
      expect(lastMessage.content).toBe('Plain message');
    });

    it('stores plain text in chat_messages even when attachments are present', async () => {
      const { messagesRepo, useCase } = buildUseCase('answer');
      const attachment = {
        mimeType: 'application/pdf',
        data: Buffer.from([0x25, 0x50, 0x44, 0x46]),
      };

      await useCase.execute({
        user: FREE_USER,
        content: 'Summarize this PDF',
        conversationHistory: [],
        attachments: [attachment],
      });

      const all = messagesRepo.getAll();
      const userMsg = all.find((m) => m.role === 'user');
      expect(userMsg?.content).toBe('Summarize this PDF');
    });
  });

  describe('text-extractable attachments', () => {
    beforeEach(() => {
      mockedConvertDocx.mockReset();
    });

    it('injects markdown attachment text into the prompt', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'Make cards from this',
        conversationHistory: [],
        attachments: [
          {
            mimeType: MARKDOWN_MIME,
            data: Buffer.from(
              '# Photosynthesis\n\nConverts light to energy.',
              'utf8'
            ),
            fileName: 'bio.md',
          },
        ],
      });

      const prompt = lastUserText(anthropic.messages.stream);
      expect(prompt).toContain('<file name="bio.md">');
      expect(prompt).toContain('Converts light to energy.');
      expect(prompt).toContain('Make cards from this');
    });

    it('injects plain text attachment text into the prompt', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'Summarize',
        conversationHistory: [],
        attachments: [
          {
            mimeType: PLAIN_TEXT_MIME,
            data: Buffer.from('Mitosis has four phases.', 'utf8'),
            fileName: 'lecture.txt',
          },
        ],
      });

      const prompt = lastUserText(anthropic.messages.stream);
      expect(prompt).toContain('<file name="lecture.txt">');
      expect(prompt).toContain('Mitosis has four phases.');
    });

    it('injects Notion .zip export text into the prompt', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'Cards please',
        conversationHistory: [],
        attachments: [
          {
            mimeType: ZIP_MIME,
            data: notionZip({
              'Cell Biology.html':
                '<html><body><h1>Ribosomes</h1><p>Synthesize proteins.</p></body></html>',
            }),
            fileName: 'notion-export.zip',
          },
        ],
      });

      const prompt = lastUserText(anthropic.messages.stream);
      expect(prompt).toContain('<file name="notion-export.zip">');
      expect(prompt).toContain('Ribosomes');
      expect(prompt).toContain('Synthesize proteins.');
    });

    it('injects .docx attachment text into the prompt', async () => {
      mockedConvertDocx.mockResolvedValue(
        '<h1>Kinetics</h1><p>Rate of reaction.</p>'
      );
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'Explain',
        conversationHistory: [],
        attachments: [
          {
            mimeType: DOCX_MIME,
            data: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
            fileName: 'chem.docx',
          },
        ],
      });

      const prompt = lastUserText(anthropic.messages.stream);
      expect(prompt).toContain('<file name="chem.docx">');
      expect(prompt).toContain('Rate of reaction.');
    });

    it('keeps a PDF as a native block while injecting a sibling .md as text', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'Combine these',
        conversationHistory: [],
        attachments: [
          {
            mimeType: 'application/pdf',
            data: Buffer.from([0x25, 0x50, 0x44, 0x46]),
            fileName: 'slides.pdf',
          },
          {
            mimeType: MARKDOWN_MIME,
            data: Buffer.from('extra md notes', 'utf8'),
            fileName: 'notes.md',
          },
        ],
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      const lastMessage = callArg.messages[callArg.messages.length - 1];
      const docBlock = lastMessage.content.find(
        (block: { type: string }) => block.type === 'document'
      );
      expect(docBlock).toBeDefined();
      const prompt = lastUserText(anthropic.messages.stream);
      expect(prompt).toContain('extra md notes');
    });
  });

  describe('attachment memory across turns', () => {
    function historyText(stream: jest.Mock, callIndex: number): string {
      const callArg = stream.mock.calls[callIndex][0];
      const priorMessages = callArg.messages.slice(0, -1);
      return priorMessages
        .map((m: { content: unknown }) =>
          typeof m.content === 'string' ? m.content : ''
        )
        .join('\n');
    }

    it('retains the attachment text on a follow-up turn in the same conversation', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      const first = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards from this',
        conversationHistory: [],
        attachments: [
          {
            mimeType: MARKDOWN_MIME,
            data: Buffer.from(
              '# Photosynthesis\n\nConverts light to energy.',
              'utf8'
            ),
            fileName: 'bio.md',
          },
        ],
      });

      await useCase.execute({
        user: FREE_USER,
        content: 'What did it say about energy?',
        conversationHistory: [
          { role: 'user', content: 'Make cards from this' },
          { role: 'assistant', content: 'answer' },
        ],
        conversationId: first.conversationId,
      });

      const text = historyText(anthropic.messages.stream, 1);
      expect(text).toContain('<file name="bio.md">');
      expect(text).toContain('Converts light to energy.');
    });

    it('persists the extracted text separately, keeping the stored message content raw', async () => {
      const { messagesRepo, useCase } = buildUseCase('answer');

      const first = await useCase.execute({
        user: FREE_USER,
        content: 'Summarize this',
        conversationHistory: [],
        attachments: [
          {
            mimeType: MARKDOWN_MIME,
            data: Buffer.from('Krebs cycle produces ATP.', 'utf8'),
            fileName: 'notes.md',
          },
        ],
      });

      const persisted = await messagesRepo.listForConversation({
        userId: FREE_USER.owner,
        conversationId: first.conversationId,
      });
      const userMsg = persisted.find((m) => m.role === 'user');
      expect(userMsg?.content).toBe('Summarize this');
      expect(userMsg?.attachmentText).toContain('<file name="notes.md">');
      expect(userMsg?.attachmentText).toContain('Krebs cycle produces ATP.');
    });

    it('caps very large extracted text carried into later turns', async () => {
      const { anthropic, useCase } = buildUseCase('answer');
      const big = `${'A'.repeat(25_000)}ENDMARKER_XYZ`;

      const first = await useCase.execute({
        user: FREE_USER,
        content: 'Make cards',
        conversationHistory: [],
        attachments: [
          {
            mimeType: MARKDOWN_MIME,
            data: Buffer.from(big, 'utf8'),
            fileName: 'big.md',
          },
        ],
      });

      await useCase.execute({
        user: FREE_USER,
        content: 'More please',
        conversationHistory: [],
        conversationId: first.conversationId,
      });

      const text = historyText(anthropic.messages.stream, 1);
      expect(text).toContain('<file name="big.md">');
      expect(text).toContain('[…truncated]');
      expect(text).not.toContain('ENDMARKER_XYZ');
      expect(text.length).toBeLessThan(21_000);
    });
  });

  describe('system prompt caching', () => {
    it('passes system as an array with a cache_control ephemeral block', async () => {
      const { anthropic, useCase } = buildUseCase('answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(Array.isArray(callArg.system)).toBe(true);
      expect(callArg.system).toHaveLength(1);
      expect(callArg.system[0]).toMatchObject({
        type: 'text',
        cache_control: { type: 'ephemeral' },
      });
    });
  });

  describe('MCQ emission', () => {
    const MCQ_RESPONSE_TEXT = `Here you go:
\`\`\`json
[{"front":"Which enzyme breaks down starch?","options":["Lipase","Amylase","Protease","Lactase"],"correct_index":1,"rationale":"Amylase hydrolyses starch."}]
\`\`\``;

    it('extracts an MCQ card for a paying user', async () => {
      const { useCase } = buildUseCase(MCQ_RESPONSE_TEXT);
      const result = await useCase.execute({
        user: PATREON_USER,
        content: 'quiz me',
        conversationHistory: [],
      });
      expect(result.cards).toHaveLength(1);
      expect(result.cards![0]).toMatchObject({
        front: 'Which enzyme breaks down starch?',
        options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
        correctIndex: 1,
        rationale: 'Amylase hydrolyses starch.',
      });
    });

    it('drops an MCQ card for a free user', async () => {
      const { useCase } = buildUseCase(MCQ_RESPONSE_TEXT);
      const result = await useCase.execute({
        user: FREE_USER,
        content: 'quiz me',
        conversationHistory: [],
      });
      expect(result.cards).toBeUndefined();
    });

    it('drops malformed MCQ (3 options) and keeps surrounding valid cards', async () => {
      const mixed = `\`\`\`json
[{"front":"valid q","back":"valid a"},{"front":"bad mcq","options":["A","B","C"],"correct_index":0}]
\`\`\``;
      const { useCase } = buildUseCase(mixed);
      const result = await useCase.execute({
        user: PATREON_USER,
        content: 'mixed',
        conversationHistory: [],
      });
      expect(result.cards).toHaveLength(1);
      expect(result.cards![0]).toMatchObject({
        front: 'valid q',
        back: 'valid a',
      });
    });

    it('adds MCQ instructions to the system prompt for paying users', async () => {
      const { anthropic, useCase } = buildUseCase('reply');
      await useCase.execute({
        user: PATREON_USER,
        content: 'q',
        conversationHistory: [],
      });
      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).toMatch(/correct_index/);
    });

    it('teaches correct ruby markup in the system prompt (furigana prod failure)', async () => {
      const { anthropic, useCase } = buildUseCase('reply');
      await useCase.execute({
        user: FREE_USER,
        content: 'q',
        conversationHistory: [],
      });
      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).toContain('<ruby>三<rt>さん</rt></ruby>');
    });

    it('does not add MCQ instructions to the system prompt for free users', async () => {
      const { anthropic, useCase } = buildUseCase('reply');
      await useCase.execute({
        user: FREE_USER,
        content: 'q',
        conversationHistory: [],
      });
      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).not.toMatch(/correct_index/);
    });
  });

  describe('MCQ structured output (templateSlug=mcq)', () => {
    function mcqToolBlock(input: unknown) {
      return { type: 'tool_use', name: 'emit_mcq_cards', input };
    }

    it('forces the MCQ tool with tool_choice when templateSlug is mcq', async () => {
      const { anthropic, useCase } = buildUseCaseWithBlocks([
        mcqToolBlock({
          cards: [
            {
              front: 'Capital of Albania?',
              options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
              correct_index: 0,
              rationale: 'Tirana is the capital.',
            },
          ],
        }),
      ]);

      await useCase.execute({
        user: FREE_USER,
        content: '10 facts about Albania',
        conversationHistory: [],
        templateSlug: 'mcq',
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.tools).toEqual([
        expect.objectContaining({ name: 'emit_mcq_cards' }),
      ]);
      expect(callArg.tool_choice).toEqual({
        type: 'tool',
        name: 'emit_mcq_cards',
      });
    });

    it('raises max_tokens on the MCQ tool path so structured output is not truncated', async () => {
      const { anthropic, useCase } = buildUseCaseWithBlocks([
        mcqToolBlock({
          cards: [
            {
              front: 'Capital of Albania?',
              options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
              correct_index: 0,
            },
          ],
        }),
      ]);

      await useCase.execute({
        user: FREE_USER,
        content: 'make mcq cards',
        conversationHistory: [],
        templateSlug: 'mcq',
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.max_tokens).toBe(8192);
    });

    it('keeps the default max_tokens for non-MCQ templates', async () => {
      const { anthropic, useCase } = buildUseCase('a basic reply');

      await useCase.execute({
        user: FREE_USER,
        content: 'hello',
        conversationHistory: [],
        templateSlug: 'basic',
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.max_tokens).toBe(4096);
    });

    it('extracts MCQ cards from the tool_use block for templateSlug=mcq', async () => {
      const { useCase } = buildUseCaseWithBlocks([
        mcqToolBlock({
          cards: [
            {
              front: 'Capital of Albania?',
              options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
              correct_index: 0,
              rationale: 'Tirana is the capital.',
            },
            {
              front: 'Albanian currency?',
              options: ['Lek', 'Euro', 'Dinar', 'Lev'],
              correct_index: 0,
            },
          ],
        }),
      ]);

      const result = await useCase.execute({
        user: FREE_USER,
        content: '10 facts about Albania',
        conversationHistory: [],
        templateSlug: 'mcq',
      });

      expect(result.cards).toHaveLength(2);
      expect(result.cards![0]).toMatchObject({
        front: 'Capital of Albania?',
        options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
        correctIndex: 0,
        rationale: 'Tirana is the capital.',
      });
      expect(result.cards![1]).toMatchObject({
        front: 'Albanian currency?',
        correctIndex: 0,
      });
    });

    it('blanks cloze markers in the MCQ stem without revealing the answer', async () => {
      const { useCase } = buildUseCaseWithBlocks([
        mcqToolBlock({
          cards: [
            {
              front:
                'Spring Boot uses {{c1::auto-configuration}} to detect deps.',
              options: [
                'auto-configuration',
                'reflection',
                'a build plugin',
                'manual wiring',
              ],
              correct_index: 0,
              rationale: 'Auto-configuration wires beans from the classpath.',
            },
          ],
        }),
      ]);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'switch to multiple choice',
        conversationHistory: [],
        templateSlug: 'mcq',
      });

      const card = result.cards![0];
      expect(card.front).not.toContain('{{c');
      expect(card.front).not.toContain('auto-configuration');
      expect(card.front).toContain('_____');
      expect(card.options).toEqual([
        'auto-configuration',
        'reflection',
        'a build plugin',
        'manual wiring',
      ]);
      expect(card.correctIndex).toBe(0);
    });

    it('leaves a clean MCQ stem untouched', async () => {
      const { useCase } = buildUseCaseWithBlocks([
        mcqToolBlock({
          cards: [
            {
              front: 'Capital of Albania?',
              options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
              correct_index: 0,
            },
          ],
        }),
      ]);

      const result = await useCase.execute({
        user: FREE_USER,
        content: 'quiz me',
        conversationHistory: [],
        templateSlug: 'mcq',
      });

      expect(result.cards![0].front).toBe('Capital of Albania?');
    });

    it('persists MCQ cards as a JSON code block that extractCards recovers on reload', async () => {
      const { messagesRepo, useCase } = buildUseCaseWithBlocks([
        { type: 'text', text: 'Here are your quiz cards:' },
        mcqToolBlock({
          cards: [
            {
              front: 'Capital of Albania?',
              options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
              correct_index: 0,
              rationale: 'Tirana is the capital.',
            },
          ],
        }),
      ]);

      const { conversationId } = await useCase.execute({
        user: FREE_USER,
        content: 'quiz me on Albania',
        conversationHistory: [],
        templateSlug: 'mcq',
      });

      const persisted = await messagesRepo.findLatestAssistantInConversation({
        userId: FREE_USER.owner,
        conversationId,
      });
      const recovered = extractCards(persisted!.content, true);
      expect(recovered.cards).toEqual([
        {
          front: 'Capital of Albania?',
          back: '',
          options: ['Tirana', 'Durrës', 'Vlorë', 'Shkodër'],
          correctIndex: 0,
          rationale: 'Tirana is the capital.',
        },
      ]);
    });

    it('round-trips MCQ cards through persistence and conversation hydration', async () => {
      const conversationsRepo = new InMemoryConversationsRepository();
      const messagesRepo = new InMemoryChatMessagesRepository();
      const anthropic = buildAnthropicMockWithBlocks([
        mcqToolBlock({
          cards: [
            {
              front: 'Albanian currency?',
              options: ['Lek', 'Euro', 'Dinar', 'Lev'],
              correct_index: 0,
            },
          ],
        }),
      ]);
      const chatUseCase = new ChatUseCase(
        messagesRepo,
        conversationsRepo,
        anthropic as never
      );

      const { conversationId, content } = await chatUseCase.execute({
        user: FREE_USER,
        content: 'quiz me',
        conversationHistory: [],
        templateSlug: 'mcq',
      });

      conversationsRepo.recordMessage({
        userId: FREE_USER.owner,
        conversationId,
        role: 'assistant',
        content,
      });

      const conversationsUseCase = new ConversationsUseCase(conversationsRepo);
      const view = await conversationsUseCase.get({
        userId: FREE_USER.owner,
        conversationId,
      });
      const assistant = view?.messages.find((m) => m.role === 'assistant');
      expect(assistant?.cards).toEqual([
        {
          front: 'Albanian currency?',
          back: '',
          options: ['Lek', 'Euro', 'Dinar', 'Lev'],
          correctIndex: 0,
        },
      ]);
    });

    it('throws McqExtractionFailedError when the model returns prose and no tool call', async () => {
      const { useCase } = buildUseCaseWithBlocks([
        { type: 'text', text: 'Here are 10 facts about Albania...' },
      ]);

      await expect(
        useCase.execute({
          user: FREE_USER,
          content: '10 facts about Albania',
          conversationHistory: [],
          templateSlug: 'mcq',
        })
      ).rejects.toBeInstanceOf(McqExtractionFailedError);
    });

    it('throws McqExtractionFailedError when the tool emits malformed MCQ cards', async () => {
      const { useCase } = buildUseCaseWithBlocks([
        mcqToolBlock({
          cards: [{ front: 'bad', options: ['A', 'B', 'C'], correct_index: 0 }],
        }),
      ]);

      await expect(
        useCase.execute({
          user: FREE_USER,
          content: 'quiz me',
          conversationHistory: [],
          templateSlug: 'mcq',
        })
      ).rejects.toBeInstanceOf(McqExtractionFailedError);
    });

    it('does not force the MCQ tool for non-mcq templates', async () => {
      const { anthropic, useCase } = buildUseCase('plain answer');

      await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
        templateSlug: 'basic',
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.tools).toBeUndefined();
      expect(callArg.tool_choice).toBeUndefined();
    });

    it('does not force the MCQ tool for a patreon user on the basic template', async () => {
      const { anthropic, useCase } = buildUseCase('plain answer');

      await useCase.execute({
        user: PATREON_USER,
        content: 'question',
        conversationHistory: [],
        templateSlug: 'basic',
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.tool_choice).toBeUndefined();
    });
  });

  describe('template slug routing', () => {
    it('adds cloze suffix to system prompt when templateSlug is cloze', async () => {
      const { anthropic, useCase } = buildUseCase('answer');
      await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
        templateSlug: 'cloze',
      });
      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).toMatch(/cloze/i);
      expect(callArg.system[0].text).toMatch(/\{\{c1::/);
    });

    it('adds basic-and-reversed suffix to system prompt when templateSlug is basic-and-reversed', async () => {
      const { anthropic, useCase } = buildUseCase('answer');
      await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
        templateSlug: 'basic-and-reversed',
      });
      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).toMatch(/both directions/i);
    });

    it('does not add any suffix for basic template', async () => {
      const { anthropic, useCase } = buildUseCase('answer');
      const baseLen = (
        await (() => {
          const uc = buildUseCase('answer');
          return uc.anthropic.messages.stream.mock.calls;
        })()
      ).length;
      await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
        templateSlug: 'basic',
      });
      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).not.toMatch(/both directions/i);
      expect(callArg.system[0].text).not.toMatch(/cloze only/i);
    });

    it('falls back to basic when templateSlug is unknown', async () => {
      const { anthropic, useCase } = buildUseCase('answer');
      await useCase.execute({
        user: FREE_USER,
        content: 'question',
        conversationHistory: [],
        templateSlug: 'image-occlusion',
      });
      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).not.toMatch(/both directions/i);
      expect(callArg.system[0].text).not.toMatch(/cloze only/i);
    });
  });

  describe('rewriteAssistantContentWithTaggedCards', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rewriteAssistantContentWithTaggedCards } =
      require('./ChatUseCase') as {
        rewriteAssistantContentWithTaggedCards: (
          content: string,
          taggedCards: unknown[]
        ) => string;
      };

    it('replaces the JSON fence body while preserving surrounding prose', () => {
      const before =
        'Here you go:\n\n```json\n[{"front":"q","back":"a"}]\n```\n\nLet me know.';
      const tagged = [{ front: 'q', back: 'a', tags: ['x', 'y'] }];
      const after = rewriteAssistantContentWithTaggedCards(before, tagged);
      expect(after).toContain('Here you go:');
      expect(after).toContain('Let me know.');
      expect(after).toContain('"tags":["x","y"]');
      expect(after.indexOf('```json')).toBeGreaterThanOrEqual(0);
    });

    it('returns content unchanged when there is no JSON block', () => {
      const before = 'No cards in this message.';
      const after = rewriteAssistantContentWithTaggedCards(before, [
        { front: 'q', back: 'a', tags: ['x'] },
      ]);
      expect(after).toBe(before);
    });
  });

  describe('regenerate', () => {
    async function seedConversation(
      messagesRepo: InMemoryChatMessagesRepository,
      conversationsRepo: InMemoryConversationsRepository,
      userId: number
    ) {
      const conversationId = await conversationsRepo.create({
        userId,
        title: 'Seeded',
      });
      const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: 'first prompt' },
        { role: 'assistant', content: 'old assistant reply' },
      ];
      for (const turn of turns) {
        await messagesRepo.insert({
          userId,
          conversationId,
          role: turn.role,
          content: turn.content,
        });
        conversationsRepo.recordMessage({
          userId,
          conversationId,
          role: turn.role,
          content: turn.content,
        });
      }
      return conversationId;
    }

    it('deletes the last assistant message and streams a fresh turn', async () => {
      const { messagesRepo, conversationsRepo, useCase } = buildUseCase(
        'new assistant reply'
      );
      const conversationId = await seedConversation(
        messagesRepo,
        conversationsRepo,
        PATREON_USER.owner
      );

      const result = await useCase.regenerate({
        user: PATREON_USER,
        conversationId,
        templateSlug: 'cloze',
      });

      expect(result.content).toBe('new assistant reply');
      expect(result.conversationId).toBe(conversationId);

      const remaining = messagesRepo
        .getAll()
        .filter((r) => r.conversation_id === conversationId);
      const assistantContents = remaining
        .filter((r) => r.role === 'assistant')
        .map((r) => r.content);
      expect(assistantContents).toEqual(['new assistant reply']);
    });

    it('leaves the prior user message untouched', async () => {
      const { messagesRepo, conversationsRepo, useCase } =
        buildUseCase('regenerated');
      const conversationId = await seedConversation(
        messagesRepo,
        conversationsRepo,
        PATREON_USER.owner
      );

      await useCase.regenerate({
        user: PATREON_USER,
        conversationId,
        templateSlug: null,
      });

      const userMessages = messagesRepo
        .getAll()
        .filter(
          (r) => r.conversation_id === conversationId && r.role === 'user'
        );
      expect(userMessages.map((r) => r.content)).toEqual(['first prompt']);
    });

    it('passes the regenerate templateSlug to the model prompt, not the stored default', async () => {
      const { messagesRepo, conversationsRepo, anthropic, useCase } =
        buildUseCase('regenerated');
      const conversationId = await seedConversation(
        messagesRepo,
        conversationsRepo,
        PATREON_USER.owner
      );

      await useCase.regenerate({
        user: PATREON_USER,
        conversationId,
        templateSlug: 'cloze',
      });

      const callArg = anthropic.messages.stream.mock.calls[0][0];
      expect(callArg.system[0].text).toMatch(/cloze deletion/i);
    });

    it('throws ChatConversationNotFoundError for an unknown conversation', async () => {
      const { useCase } = buildUseCase('x');
      await expect(
        useCase.regenerate({
          user: PATREON_USER,
          conversationId: 999,
          templateSlug: null,
        })
      ).rejects.toBeInstanceOf(ChatConversationNotFoundError);
    });

    it('rejects a free user over the monthly cap without calling Claude', async () => {
      const { messagesRepo, conversationsRepo, anthropic, useCase } =
        buildUseCase('should not be produced');
      const conversationId = await seedConversation(
        messagesRepo,
        conversationsRepo,
        FREE_USER.owner
      );
      for (let i = 0; i < 20; i++) {
        await messagesRepo.insert({
          userId: FREE_USER.owner,
          conversationId,
          role: 'user',
          content: `filler ${i}`,
        });
      }

      await expect(
        useCase.regenerate({
          user: FREE_USER,
          conversationId,
          templateSlug: null,
        })
      ).rejects.toBeInstanceOf(ChatRateLimitError);
      expect(anthropic.messages.stream).not.toHaveBeenCalled();
    });

    it('lets a free user under the monthly cap regenerate', async () => {
      const { messagesRepo, conversationsRepo, anthropic, useCase } =
        buildUseCase('fresh reply');
      const conversationId = await seedConversation(
        messagesRepo,
        conversationsRepo,
        FREE_USER.owner
      );

      const result = await useCase.regenerate({
        user: FREE_USER,
        conversationId,
        templateSlug: null,
      });

      expect(result.content).toBe('fresh reply');
      expect(anthropic.messages.stream).toHaveBeenCalledTimes(1);
    });
  });

  describe('ChatRateLimitError', () => {
    it('provides a resetDate as the first of next month', async () => {
      const { messagesRepo, useCase } = buildUseCase('');
      for (let i = 0; i < 20; i++) {
        await messagesRepo.insert({
          userId: FREE_USER.owner,
          conversationId: null,
          role: 'user',
          content: `msg ${i}`,
        });
      }

      let caughtError: ChatRateLimitError | null = null;
      try {
        await useCase.execute({
          user: FREE_USER,
          content: 'more',
          conversationHistory: [],
        });
      } catch (err) {
        if (err instanceof ChatRateLimitError) {
          caughtError = err;
        }
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.resetDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
